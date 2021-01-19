const log = require('./logger').logger
const pLimit = require('p-limit')
const config = require('../config.js')
const token = require('./token')
const unique = require('./unique')
const proto = require('./proto/protoheader')
const db = require('./db')
const cache = require('./cache')

const TOKEN_TYPE = 1
const UNIQUE_TYPE = 2

const supportTypes = {}
supportTypes[TOKEN_TYPE] = token
supportTypes[UNIQUE_TYPE] = unique 

// script: buffer type
function isValidHeader(script) {
  const len = script.length

  // check flag and type 
  if (len < proto.getHeaderLen()) {
    log.debug('isValidHeader: failed len %s', len)
    return false
  }

  if (!proto.HasProtoFlag(script)) {
    log.debug('isValidHeader: failed proto flag %s, %s, %s', proto.getFlag(script).toString(), proto.PROTO_FLAG.toString(), proto.getFlag(script).compare(proto.PROTO_FLAG))
    return false
  }

  const type = proto.getHeaderType(script)

  if (supportTypes[type] === undefined) {
    log.debug('isValidHeader: failed supportTypes %s, %s', type, supportTypes)
    return false
  }

  specTypeLen = supportTypes[type].getHeaderLen(script)
  if (specTypeLen > 0 && len < specTypeLen) {
    log.debug('isValidHeader: failed data len %s, %s', len, supportTypes[type].getHeaderLen())
    return false
  }

  return true
}

// if tx is oracle type, return true else false
async function processTx(tx) {
  log.debug("oracle.processTx: %s", tx.id)
  const validInputs = new Map()
  const validOutputs = new Map()
  let isOracleTx = false

  const tasks = []
  const limit = pLimit(config.db.max_concurrency)
  for (let i = 0; i < tx.inputs.length; i++) {
    const input = tx.inputs[i]
    const prevTxIdHex = input.prevTxId.toString('hex')
    // first check the cache
    if (cache.delUtxo(prevTxIdHex, input.outputIndex) === false) {
      log.debug('input tx not in cache %s, %s', prevTxIdHex, input.outputIndex)
      continue
    }

    tasks.push(limit(async function() {
      log.debug('txjson %s', tx.toJSON())
      log.debug('oracle.processTx: try remove utxo %s', input)
      if (input.prevTxId !== undefined) {
        const res = await db.oracleUtxo.remove(input.prevTxId, input.outputIndex)
        return [res, input]
      } else {
        return [null, null]
      }
    }))
  }

  const results = await Promise.all(tasks)
  for (const res of results) {
    const dbres = res[0]
    const input = res[1]
    log.debug("remove utxo res: %s, input %s, res %s", dbres, input, res)
    if (dbres !== null) {
      const type = dbres['type']
      log.debug("input value: type %s, %s, %s", type, typeof type, dbres)
      if (!validInputs[type]) {
        validInputs[type] = []
      }
      const script = dbres['script']
      validInputs[type].push([input, script])
    }
  }

  for (let i = 0; i < tx.outputs.length; i++) {
    const output = tx.outputs[i]
    const script = output.script.toBuffer()
    log.debug('script %s, is valid %s', script.toString('hex'), isValidHeader(script))
    if (isValidHeader(script)) {
      const type = proto.getHeaderType(script)
      log.debug('output type %s, %s', type, typeof type)
      if (validOutputs[type] === undefined) {
        validOutputs[type] = []
      }
      validOutputs[type].push([i, output])
    }
  }

  log.debug('oracle.processTx: validOutputs %s, validInputs %s', validOutputs, validInputs)
  if (validOutputs.length <= 0 && validInputs.length <= 0) {
    return false
  } 
  
  if (validInputs.length > 0) {
    isOracleTx = true
  }

  // handle all type tx
  // TODO: use tasks concurrency
  for (type in validOutputs) {
    if (supportTypes[type] !== undefined) {
      let inputs = []
      if (validInputs[type] !== undefined) {
        inputs = validInputs[type]
      }
      const res = await supportTypes[type].processTx(tx, inputs, validOutputs[type])
      if (res === true) {
        isOracleTx = true
      }
    }
  }

  return isOracleTx
}


module.exports = {
  processTx: processTx,
}