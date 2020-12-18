const log = require('./logger').logger
const pLimit = require('p-limit')
const Config = require('./config.js')
const Token = require('./token')
const Proto = require('./protoheader')
const db = require('./db')

const TOKEN_TYPE = 1

const supportTypes = {
  TOKEN_TYPE: Token,
}

// script: buffer type
function isValidHeader(script) {
  let len = script.length

  // check flag and type 
  if (len < Proto.getHeaderLen()) {
    return false
  }

  if (Proto.HasProtoFlag(script)) {
    return false
  }

  let type = Proto.getHeaderType(script)

  if (supportTypes[type] === undefined) {
    return false
  }

  if (len < supportTypes[type].getHeaderLen()) {
    return false
  }

  return true
}

// if tx is backtrace type, return true else false
async function processTx(tx) {
  log.debug("backtrace.processTx: %s", tx.id)
  let validInputs = {}
  let validOutputs = {}
  let isBacktraceTx = false

  let tasks = []
  const limit = pLimit(Config.db.max_concurrency)
  for (let i = 0; i < tx.inputs.length; i++) {
    let input = tx.inputs[i]
    tasks.push(limit(async function() {
      // try to remove spend tx
      // TODO: posible performance bottleneck, every tx's input will try to write db, if we can get the lock script of input, we can avoid this
      log.debug('txjson %s', tx.toJSON())
      log.debug('backtrace.processTx: try remove utxo %s', input)
      if (input.prevTxId !== undefined) {
        let res = await db.utxo.remove(input.prevTxId.toString('hex'), input.outputIndex)
        return [res, input]
      } else {
        return [null, null]
      }
    }))
  }

  let results = await Promise.all(tasks)
  log.debug('remove task results %s', results)
  for (const res of results) {
    let dbres = res[0]
    let input = res[1]
    log.debug("remove utxo res: %s, input %s, res %s", dbres, input, res)
    if (dbres && dbres.ok == 1 && dbres.value != null) {
      let type = dbres.value['type']
      if (!validInputs[type]) {
        validInputs[type] = []
      }
      input.script = dbres.value['script']
      validInputs[type].push(input)
    }
  }

  for (let i = 0; i < tx.outputs.length; i++) {
    let output = tx.outputs[i]
    let script = output.script.toBuffer()
    if (isValidHeader(script)) {
      let type = getHeaderType(script)
      if (!validOutputs) {
        validOutputs[type] = []
      }
      validOutputs[type].push([i, output])
    }
  }

  if (validOutputs.length <= 0 && validInputs.length <= 0) {
    return false
  } 
  
  if (validInputs.length > 0) {
    isBacktraceTx = true
  }

  // handle all type tx
  // TODO: usr tasks concurrency
  for (type in validOutputs) {
    if (supportTypes[type] !== undefined) {
      let inputs = []
      if (validInputs[type] !== undefined) {
        inputs = validInputs[type]
      }
      let res = await supportTypes[type].processTx(tx, inputs, validOutputs[type])
      if (res == true) {
        isBacktraceTx = true
      }
    }
  }

  return isBacktraceTx
}


module.exports = {
  processTx: processTx,
}