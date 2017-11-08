import last from 'lodash/last'
import initial from 'lodash/initial'
import {
  compileJSONPointer, toEsonPath, esonToJson, findNextProp,
  pathsFromSelection, findRootPath, findSelectionIndices
} from './eson'
import { findUniqueName } from  './utils/stringUtils'
import { getIn } from  './utils/immutabilityHelpers'
import { isObject, stringConvert } from  './utils/typeUtils'
import { compareAsc, compareDesc, strictShallowEqual } from './utils/arrayUtils'


/**
 * Create a JSONPatch to change the value of a property or item
 * @param {ESON} data
 * @param {Path} path
 * @param {*} value
 * @return {Array}
 */
export function changeValue (data, path, value) {
  // console.log('changeValue', data, value)

  const esonPath = toEsonPath(data, path)
  const oldDataValue = getIn(data, esonPath)

  return [{
    op: 'replace',
    path: compileJSONPointer(path),
    value: value,
    jsoneditor: {
      type: oldDataValue.type
    }
  }]
}

/**
 * Create a JSONPatch to change a property name
 * @param {ESON} data
 * @param {Path} parentPath
 * @param {string} oldProp
 * @param {string} newProp
 * @return {Array}
 */
export function changeProperty (data, parentPath, oldProp, newProp) {
  // console.log('changeProperty', parentPath, oldProp, newProp)

  const esonPath = toEsonPath(data, parentPath)
  const parent = getIn(data, esonPath)

  // prevent duplicate property names
  const uniqueNewProp = findUniqueName(newProp, parent.props.map(p => p.name))

  return [{
    op: 'move',
    from: compileJSONPointer(parentPath.concat(oldProp)),
    path: compileJSONPointer(parentPath.concat(uniqueNewProp)),
    jsoneditor: {
      before: findNextProp(parent, oldProp)
    }
  }]
}

/**
 * Create a JSONPatch to change the type of a property or item
 * @param {ESON} data
 * @param {Path} path
 * @param {ESONType} type
 * @return {Array}
 */
export function changeType (data, path, type) {
  const esonPath = toEsonPath(data, path)
  const oldValue = esonToJson(getIn(data, esonPath))
  const newValue = convertType(oldValue, type)

  // console.log('changeType', path, type, oldValue, newValue)

  return [{
    op: 'replace',
    path: compileJSONPointer(path),
    value: newValue,
    jsoneditor: {
      type
    }
  }]
}

/**
 * Create a JSONPatch for a duplicate action.
 *
 * This function needs the current data in order to be able to determine
 * a unique property name for the duplicated node in case of duplicating
 * and object property
 *
 * @param {ESON} data
 * @param {ESONSelection} selection
 * @return {Array}
 */
export function duplicate (data, selection) {
  // console.log('duplicate', path)

  const rootPath = findRootPath(selection)
  const start = selection.start.path[rootPath.length]
  const end = selection.end.path[rootPath.length]
  const root = getIn(data, toEsonPath(data, rootPath))
  const { maxIndex } = findSelectionIndices(root, start, end)
  const paths = pathsFromSelection(data, selection)

  if (root.type === 'Array') {
    return paths.map((path, offset) => ({
      op: 'copy',
      from: compileJSONPointer(path),
      path: compileJSONPointer(rootPath.concat(maxIndex + offset))
    }))
  }
  else { // object.type === 'Object'
    const { maxIndex } = findSelectionIndices(root, start, end)
    const nextProp = root.props && root.props[maxIndex]
    const before = nextProp ? nextProp.name : null

    return paths.map(path => {
      const prop = last(path)
      const newProp = findUniqueName(prop, root.props.map(p => p.name))

      return {
        op: 'copy',
        from: compileJSONPointer(path),
        path: compileJSONPointer(rootPath.concat(newProp)),
        jsoneditor: {
          before
        }
      }
    })
  }
}

/**
 * Create a JSONPatch for an insert action.
 *
 * This function needs the current data in order to be able to determine
 * a unique property name for the inserted node in case of duplicating
 * and object property
 *
 * @param {ESON} data
 * @param {Path} path
 * @param {ESONType} type
 * @return {Array}
 */
export function insert (data, path, type) {
  // console.log('insert', path, type)

  const parentPath = path.slice(0, path.length - 1)
  const esonPath = toEsonPath(data, parentPath)
  const parent = getIn(data, esonPath)
  const value = createEntry(type)

  if (parent.type === 'Array') {
    const index = parseInt(path[path.length - 1]) + 1
    return [{
      op: 'add',
      path: compileJSONPointer(parentPath.concat(index)),
      value,
      jsoneditor: {
        type
      }
    }]
  }
  else { // object.type === 'Object'
    const prop = path[path.length - 1]
    const newProp = findUniqueName('', parent.props.map(p => p.name))

    return [{
      op: 'add',
      path: compileJSONPointer(parentPath.concat(newProp)),
      value,
      jsoneditor: {
        type,
        before: findNextProp(parent, prop)
      }
    }]
  }
}

/**
 * Create a JSONPatch for an insert action.
 *
 * This function needs the current data in order to be able to determine
 * a unique property name for the inserted node in case of duplicating
 * and object property
 *
 * @param {ESON} data
 * @param {Path} path
 * @param {Array.<{name?: string, value: JSONType, type?: ESONType}>} values
 * @return {Array}
 */
export function insertBefore (data, path, values) {  // TODO: find a better name and define datastructure for values
  const parentPath = initial(path)
  const esonPath = toEsonPath(data, parentPath)
  const parent = getIn(data, esonPath)

  if (parent.type === 'Array') {
    const startIndex = parseInt(last(path))
    return values.map((entry, offset) => ({
      op: 'add',
      path: compileJSONPointer(parentPath.concat(startIndex + offset)),
      value: entry.value,
      jsoneditor: {
        type: entry.type
      }
    }))
  }
  else { // object.type === 'Object'
    const before = last(path)
    return values.map(entry => {
      const newProp = findUniqueName(entry.name, parent.props.map(p => p.name))
      return {
        op: 'add',
        path: compileJSONPointer(parentPath.concat(newProp)),
        value: entry.value,
        jsoneditor: {
          type: entry.type,
          before
        }
      }
    })
  }
}

/**
 * Create a JSONPatch for an insert action.
 *
 * This function needs the current data in order to be able to determine
 * a unique property name for the inserted node in case of duplicating
 * and object property
 *
 * @param {ESON} data
 * @param {ESONSelection} selection
 * @param {Array.<{name?: string, value: JSONType, type?: ESONType}>} values
 * @return {Array}
 */
export function replace (data, selection, values) {  // TODO: find a better name and define datastructure for values

  const rootPath = findRootPath(selection)
  const start = selection.start.path[rootPath.length]
  const end = selection.end.path[rootPath.length]
  const root = getIn(data, toEsonPath(data, rootPath))
  const { minIndex, maxIndex } = findSelectionIndices(root, start, end)

  if (root.type === 'Array') {
    const removeActions = removeAll(pathsFromSelection(data, selection))
    const insertActions = values.map((entry, offset) => ({
      op: 'add',
      path: compileJSONPointer(rootPath.concat(minIndex + offset)),
      value: entry.value,
      jsoneditor: {
        type: entry.type
      }
    }))

    return removeActions.concat(insertActions)
  }
  else { // object.type === 'Object'
    const nextProp = root.props && root.props[maxIndex]
    const before = nextProp ? nextProp.name : null

    const removeActions = removeAll(pathsFromSelection(data, selection))
    const insertActions = values.map(entry => {
      const newProp = findUniqueName(entry.name, root.props.map(p => p.name))
      return {
        op: 'add',
        path: compileJSONPointer(rootPath.concat(newProp)),
        value: entry.value,
        jsoneditor: {
          type: entry.type,
          before
        }
      }
    })

    return removeActions.concat(insertActions)
  }
}

/**
 * Create a JSONPatch for an append action.
 *
 * This function needs the current data in order to be able to determine
 * a unique property name for the inserted node in case of duplicating
 * and object property
 *
 * @param {ESON} data
 * @param {Path} parentPath
 * @param {ESONType} type
 * @return {Array}
 */
export function append (data, parentPath, type) {
  // console.log('append', parentPath, value)

  const esonPath = toEsonPath(data, parentPath)
  const parent = getIn(data, esonPath)
  const value = createEntry(type)

  if (parent.type === 'Array') {
    return [{
      op: 'add',
      path: compileJSONPointer(parentPath.concat('-')),
      value,
      jsoneditor: {
        type
      }
    }]
  }
  else { // object.type === 'Object'
    const newProp = findUniqueName('', parent.props.map(p => p.name))

    return [{
      op: 'add',
      path: compileJSONPointer(parentPath.concat(newProp)),
      value,
      jsoneditor: {
        type
      }
    }]
  }
}

/**
 * Create a JSONPatch for a remove action
 * @param {Path} path
 * @return {ESONPatch}
 */
export function remove (path) {
  return [{
    op: 'remove',
    path: compileJSONPointer(path)
  }]
}

/**
 * Create a JSONPatch for a multiple remove action
 * @param {Path[]} paths
 * @return {ESONPatch}
 */
export function removeAll (paths) {
  return paths.map(path => ({
    op: 'remove',
    path: compileJSONPointer(path)
  }))
}
// TODO: test removeAll

/**
 * Create a JSONPatch to order the items of an array or the properties of an object in ascending
 * or descending order
 * @param {ESON} data
 * @param {Path} path
 * @param {'asc' | 'desc' | null} [order=null]  If not provided, will toggle current ordering
 * @return {Array}
 */
export function sort (data, path, order = null) {
  // console.log('sort', path, order)

  const compare = order === 'desc' ? compareDesc : compareAsc
  const esonPath = toEsonPath(data, path)
  const object = getIn(data, esonPath)

  if (object.type === 'Array') {
    const orderedItems = object.items.slice(0)

    // order the items by value
    orderedItems.sort((a, b) => compare(a.value, b.value))

    // when no order is provided, test whether ordering ascending
    // changed anything. If not, sort descending
    if (!order && strictShallowEqual(object.items, orderedItems)) {
      orderedItems.reverse()
    }

    return [{
      op: 'replace',
      path: compileJSONPointer(path),
      value: esonToJson({
        type: 'Array',
        items: orderedItems
      })
    }]
  }
  else { // object.type === 'Object'
    const orderedProps = object.props.slice(0)

    // order the properties by key
    orderedProps.sort((a, b) => compare(a.name, b.name))

    // when no order is provided, test whether ordering ascending
    // changed anything. If not, sort descending
    if (!order && strictShallowEqual(object.props, orderedProps)) {
      orderedProps.reverse()
    }

    return [{
      op: 'replace',
      path: compileJSONPointer(path),
      value: esonToJson({
        type: 'Object',
        props: orderedProps
      }),
      jsoneditor: {
        order: orderedProps.map(prop => prop.name)
      }
    }]
  }
}

/**
 * Create a JSON entry
 * @param {ESONType} type
 * @return {Array | Object | string}
 */
export function createEntry (type) {
  if (type === 'Array') {
    return []
  }
  else if (type === 'Object') {
    return {}
  }
  else {
    return ''
  }
}

/**
 * Convert a JSON object into a different type. When possible, data is retained
 * @param {*} value
 * @param {ESONType} type
 * @return {*}
 */
export function convertType (value, type) {
  // convert contents from old value to new value where possible
  if (type === 'value') {
    if (typeof value === 'string') {
      return stringConvert(value)
    }
    else {
      return ''
    }
  }

  if (type === 'string') {
    if (!isObject(value) && !Array.isArray(value)) {
      return value + ''
    }
    else {
      return ''
    }
  }

  if (type === 'Object') {
    let object = {}

    if (Array.isArray(value)) {
      value.forEach((item, index) => object[index] = item)
    }

    return object
  }

  if (type === 'Array') {
    let array = []

    if (isObject(value)) {
      Object.keys(value).forEach(key => {
        array.push(value[key])
      })
    }

    return array
  }

  throw new Error(`Unknown type '${type}'`)
}