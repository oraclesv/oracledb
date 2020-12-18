const pLimit = require('p-limit')
const proto = require('./protoheader')
const db = require('./db')
const config = require('./config.js')
const log = require('./logger').logger

var token = module.exports

// token specific
//<type specific data> = <is_genesis(1 byte)> <public key hash(20 bytes)> + <token value(8 bytes)> + <genesis script code hash as tokenid(20 bytes)> + <proto header>
const TOKEN_ID_LEN = 20
const TOKEN_VALUE_LEN = 8
const TOKEN_ADDRESS_LEN = 20
const GENESIS_FLAG_LEN = 1
const TOKEN_ID_OFFSET = TOKEN_ID_LEN + proto.getHeaderLen()
const TOKEN_VALUE_OFFSET = TOKEN_ID_OFFSET + TOKEN_VALUE_LEN
const TOKEN_ADDRESS_OFFSET = TOKEN_VALUE_OFFSET + TOKEN_ADDRESS_LEN
const GENESIS_FLAG_OFFSET = TOKEN_ADDRESS_OFFSET + GENESIS_FLAG_LEN
const TOKEN_HEADER_LEN = GENESIS_FLAG_OFFSET

const GENESIS_TOKEN_ID = Buffer.alloc(TOKEN_ID_LEN, 0).toString('hex')

token.getHeaderLen = function() {
  return TOKEN_HEADER_LEN
}

token.getTokenValue = function(script) {
  return script.readBigUInt64LE(script.length - TOKEN_VALUE_OFFSET)
}

token.getTokenID = function(script) {
  return script.subarray(script.length - TOKEN_ID_OFFSET, script.length - TOKEN_ID_OFFSET + TOKEN_ID_LEN).toString('hex');
}

token.getTokenAddress = function(script) {
  return script.subarray(script.length - TOKEN_ADDRESS_OFFSET, script.length - TOKEN_ADDRESS_OFFSET + TOKEN_ADDRESS_LEN).toString('hex');
}

token.getGenesisFlag = function(script) {
    return script.readUIntLE(script.length - GENESIS_FLAG_OFFSET, GENESIS_FLAG_LEN)
}

token.insertTokenIDOutput = function(txid, tokenID, outputs, tasks, limit) {
  log.debug('insertTokenIDOutput: txid %s, tokenID %s, outputs %s', txid, tokenID, outputs)
  for (const outputData of outputs) {
    const outputIndex = outputData[0]
    const output = outputData[1]
    log.debug('insertTokenIDOutput: outputIndex %s, output %s', outputIndex, output)
    const script = output.script.toBuffer()
    const isGenesis = token.getGenesisFlag(script)
    const data = {
      'txid': txid,
      'outputIndex': outputIndex,
      'script': script.toString('hex'),
      'address': token.getTokenAddress(script),
      'tokenID': tokenID,
      'tokenValue': token.getTokenValue(script),
      'isGenesis': isGenesis,
    }
    tasks.push(limit(async function() {
      const res = await db.utxo.insert(data)
      return res
    }))
  }
}

token.processTx = async function(tx, validInputs, validOutputs) {
  log.debug('token.processTx: tx %s, validInputs %s, validOutputs %s', tx, validInputs, validOutputs)
  let outValue = {}
  let tokenIDOutputs = {}
  let flag = false

  let tasks = []
  const limit = pLimit(config.db.max_concurrency)
  // count the output token value
  for (const outputData of validOutputs) {
    let output = outputData[1]
    let script = output.script.toBuffer()
    let value = token.getTokenValue(script)
    let tokenID = token.getTokenID(script)
    let isGenesis = token.getGenesisFlag(script)
    log.debug('token.processTx: output value %s, tokenID %s, isGenesis %s', value, tokenID, isGenesis)
    if (isGenesis == 1) {
      // genesis tx data limit
      log.debug('token.processTx: check genesis args: %s, %s', outputData[0], outputData[1])
      if (value == 0 && tokenID == GENESIS_TOKEN_ID) {
        token.insertTokenIDOutput(tx.id, tokenID, [outputData], tasks, limit)
      }
      continue
    }
    if (!outValue[tokenID]) {
      outValue[tokenID] = 0
      tokenIDOutputs[tokenID] = []
    }
    outValue[tokenID] += value
    tokenIDOutputs[tokenID].push(outputData)
  }

  // count the input token value
  let inValue = {}
  for (const input of validInputs) {
    let script = input.script.toBuffer()
    let value = token.getTokenValue(script)
    let tokenID = token.getTokenID(script)
    if (!inValue[tokenID]) {
      inValue[tokenID] = 0
    }
    inValue[tokenID] += value
  }

  // compare token input and output
  let invalidTokenID = []
  for (tokenID in outValue) {
    if (outValue[tokenID] != inValue[tokenID]) {
      invalidTokenID.push(tokenID)
      log.warn("token.processTx invalidTokenID %s, txid %s", tokenID, tx.id)
    } else {
      token.insertTokenIDOutput(tx.id, tokenID, tokenIDOutputs[tokenID], tasks, limit)
    }
  }

  // check the genesis input
  for (const tokenID of invalidTokenID) {
    // need to check if has genesis token 
    let scriptHash = tokenID
    for (input in validInputs) {
      let inputScriptHash = Buffer.from(bsv.crypto.Hash.sha256ripemd160(input.scriptHash))
      if (inputScriptHash.compare(scriptHash) == 0) {
        token.insertTokenIDOutput(tx.id, tokenID, tokenIDOutputs[tokenID], tasks, limit)
      }
    }
  }

  if (tasks.length > 0) {
    flag = true
    let res = await Promise.all(tasks)
    log.debug('token.processTx insert res:', res)
  }

  return flag
}