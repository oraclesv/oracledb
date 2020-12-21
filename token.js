const pLimit = require('p-limit')
const bsv = require('bsv')

const proto = require('./protoheader')
const db = require('./db')
const config = require('./config.js')
const log = require('./logger').logger
const cache = require('./cache')

const token = module.exports

const TOKEN_TYPE = 1
// token specific
//<type specific data> = <token_name (10 bytes)> <is_genesis(1 byte)> <public key hash(20 bytes)> + <token value(8 bytes)> + <genesis script code hash as tokenid(20 bytes)> + <proto header>
const TOKEN_ID_LEN = 20
const TOKEN_VALUE_LEN = 8
const TOKEN_ADDRESS_LEN = 20
const GENESIS_FLAG_LEN = 1
const TOKEN_NAME_LEN = 10
const TOKEN_ID_OFFSET = TOKEN_ID_LEN + proto.getHeaderLen()
const TOKEN_VALUE_OFFSET = TOKEN_ID_OFFSET + TOKEN_VALUE_LEN
const TOKEN_ADDRESS_OFFSET = TOKEN_VALUE_OFFSET + TOKEN_ADDRESS_LEN
const GENESIS_FLAG_OFFSET = TOKEN_ADDRESS_OFFSET + GENESIS_FLAG_LEN
const TOKEN_NAME_OFFSET = GENESIS_FLAG_OFFSET + TOKEN_NAME_LEN 
const TOKEN_HEADER_LEN = TOKEN_NAME_OFFSET

const GENESIS_TOKEN_ID = Buffer.alloc(TOKEN_ID_LEN, 0)
const EMPTY_ADDRESS = Buffer.alloc(ADDRESS_LEN, 0)

token.getHeaderLen = function() {
  return TOKEN_HEADER_LEN
}

token.getTokenValue = function(script) {
  return script.readBigUInt64LE(script.length - TOKEN_VALUE_OFFSET)
}

token.getTokenID = function(script) {
  return script.subarray(script.length - TOKEN_ID_OFFSET, script.length - TOKEN_ID_OFFSET + TOKEN_ID_LEN);
}

token.getTokenAddress = function(script) {
  return script.subarray(script.length - TOKEN_ADDRESS_OFFSET, script.length - TOKEN_ADDRESS_OFFSET + TOKEN_ADDRESS_LEN);
}

token.getGenesisFlag = function(script) {
    return script.readUIntLE(script.length - GENESIS_FLAG_OFFSET, GENESIS_FLAG_LEN)
}

token.getTokenName = function(script) {
  return script.subarray(script.length - TOKEN_NAME_OFFSET, script.length - TOKEN_NAME_OFFSET + TOKEN_NAME_LEN).toString()
}

token.insertTokenIDOutput = function(txid, tokenID, outputs, tasks, limit) {
  log.debug('insertTokenIDOutput: txid %s, tokenID %s, outputs %s', txid, tokenID.toString('hex'), outputs)
  for (const outputData of outputs) {
    const outputIndex = outputData[0]
    const output = outputData[1]
    log.debug('insertTokenIDOutput: outputIndex %s, output %s', outputIndex, output)
    const script = output.script.toBuffer()
    const isGenesis = token.getGenesisFlag(script)
    const data = {
      'txid': txid,
      'outputIndex': outputIndex,
      'script': script,
      'address': token.getTokenAddress(script),
      'tokenID': tokenID,
      'tokenValue': token.getTokenValue(script),
      'isGenesis': isGenesis,
      'type': TOKEN_TYPE,
      'tokenName': token.getTokenName(script),
    }
    tasks.push(limit(async function() {
      const res = await db.utxo.insert(data)
      return [res, txid, outputIndex]
    }))
  }
}

token.processTx = async function(tx, validInputs, validOutputs) {
  log.debug('token.processTx: tx %s, validInputs %s, validOutputs %s', tx, validInputs, validOutputs)
  const outValue = {}
  const tokenIDOutputs = {}
  let flag = false

  const tasks = []
  const limit = pLimit(config.db.max_concurrency)
  // count the output token value
  for (const outputData of validOutputs) {
    const output = outputData[1]
    const script = output.script.toBuffer()
    const value = token.getTokenValue(script)
    const tokenID = token.getTokenID(script)
    const tokenIDHex = tokenID.toString('hex')
    const isGenesis = token.getGenesisFlag(script)
    const address = token.getTokenAddress(script)
    log.debug('token.processTx: output value %s, tokenID %s, isGenesis %s', value, tokenIDHex, isGenesis)
    if (isGenesis === 1) {
      // genesis tx data limit
      log.debug('token.processTx: check genesis args: %s, %s', outputData[0], outputData[1])
      if (value === BigInt(0) && tokenID.compare(GENESIS_TOKEN_ID) === 0 && address.compare(EMPTY_ADDRESS) === 0) {
        token.insertTokenIDOutput(tx.id, tokenID, [outputData], tasks, limit)
      }
      continue
    }
    if (!outValue[tokenIDHex]) {
      outValue[tokenIDHex] = BigInt(0)
      tokenIDOutputs[tokenIDHex] = []
    }
    outValue[tokenIDHex] += value
    tokenIDOutputs[tokenIDHex].push(outputData)
  }

  // count the input token value
  const inValue = {}
  for (const inputData of validInputs) {
    //const input = inputData[0]
    const script = inputData[1]
    log.debug('input script: %s, %s', script.length, script.toString('hex'))
    const value = token.getTokenValue(script)
    const tokenID = token.getTokenID(script)
    const tokenIDHex = tokenID.toString('hex')
    if (inValue[tokenIDHex] === undefined) {
      inValue[tokenIDHex] = BigInt(0)
    }
    inValue[tokenIDHex] += value
  }

  // compare token input and output
  const invalidTokenID = []
  for (const tokenIDHex in outValue) {
    if (outValue[tokenIDHex] !== inValue[tokenIDHex]) {
      invalidTokenID.push(tokenIDHex)
      log.warn("token.processTx invalidTokenID %s, txid %s, outvalue %s, invalue %s", tokenIDHex, tx.id, outValue[tokenIDHex], inValue[tokenIDHex])
    } else {
      token.insertTokenIDOutput(tx.id, Buffer.from(tokenIDHex, 'hex'), tokenIDOutputs[tokenIDHex], tasks, limit)
    }
  }

  // check the genesis input
  for (const tokenIDHex of invalidTokenID) {
    // need to check if has genesis token 
    for (const inputData of validInputs) {
      const script = inputData[1]
      const inputScriptHash = Buffer.from(bsv.crypto.Hash.sha256ripemd160(script))
      log.debug("check input script hash: %s, tokenID %s", inputScriptHash.toString('hex'), tokenIDHex)
      if (inputScriptHash.toString('hex') === tokenIDHex) {
        token.insertTokenIDOutput(tx.id, Buffer.from(tokenIDHex, 'hex'), tokenIDOutputs[tokenIDHex], tasks, limit)
      }
    }
  }

  if (tasks.length > 0) {
    flag = true
    const res = await Promise.all(tasks)
    log.debug('token.processTx insert res: %s', res)
    for (const item of res) {
      const succ = item[0]
      const txid = item[1]
      const index = item[2]
      if (succ === true) {
        cache.addUtxo(txid, index, 1)
      }
      log.debug("add cache: %s, %s, %s", succ, txid, index)
    }
  }

  return flag
}