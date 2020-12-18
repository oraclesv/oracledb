const pLimit = require('p-limit')
const Proto = require('./protoheader')
const db = require('./db')

var Token = module.exports

// token specific
//<type specific data> = <is_genesis(1 byte)> <public key hash(20 bytes)> + <token value(8 bytes)> + <genesis script code hash as tokenid(20 bytes)> + <proto header>
const TOKEN_ID_LEN = 20
const TOKEN_VALUE_LEN = 8
const ADDRESS_LEN = 20
const GENESIS_FLAG_LEN = 1
const TOKEN_ID_OFFSET = TOKEN_ID_LEN + Proto.getHeaderLen()
const TOKEN_VALUE_OFFSET = TOKEN_ID_OFFSET + TOKEN_VALUE_LEN
const TOKEN_ADDRESS_OFFSET = TOKEN_VALUE_OFFSET + ADDRESS_LEN
const GENESIS_FLAG_OFFSET = TOKEN_ADDRESS_OFFSET + GENESIS_FLAG_LEN
const TOKEN_HEADER_LEN = GENESIS_FLAG_OFFSET
const GENESIS_TOKEN_ID = Buffer.alloc(TOKEN_HEADER_LEN, 0).toString('hex')

Token.getHeaderLen = function() {
  return TOKEN_HEADER_LEN
}

Token.getTokenValue = function(script) {
  return script.readUIntLE(script.length - TOKEN_VALUE_OFFSET, TOKEN_VALUE_LEN)
}

Token.getTokenID = function(script) {
  return script.subarray(script.length - TOKEN_ID_OFFSET, script.length - TOKEN_ID_OFFSET + TOKEN_ID_LEN).toString('hex');
}

Token.getTokenAddress = function(script) {
  return script.subarray(script.length - TOKEN_ADDRESS_OFFSET).toString('hex')
}

Token.getGenesisFlag = function(script) {
    return script.readUIntLE(GENESIS_FLAG_OFFSET, GENESIS_FLAG_LEN)
}

Token.insertTokenIDOutput = function(txid, tokenID, outputs, tasks, limit) {
  for (outputData in outputs) {
    let {outputIndex, output} = outputData
    let script = output.script
    let isGenesis = Token.getGenesisFlag(script)
    let data = {
      'txid': txid,
      'outputIndex': outputIndex,
      'script': script,
      'address': Token.getTokenAddress(script),
      'tokenID': tokenID,
      'tokenValue': Token.getTokenValue(script),
      'isGenesis': isGenesis,
    }
    tasks.push(limit(async function() {
      let res = await db.utxo.insert(data)
      return res
    }))
  }
}

Token.processTx = async function(tx, validInputs, validOutputs) {
  let outValue = {}
  let tokenIDOutputs = {}
  let flag = false

  let tasks = []
  const limit = pLimit(Config.db.max_concurrency)
  // count the output token value
  for (outputData in validOutputs) {
    let output = outputData[1]
    let script = Buffer.from(output.script, 'hex')
    let value = Token.getTokenValue(script)
    let tokenID = Token.getTokenID(script)
    let isGenesis = Token.getGenesisFlag(script)
    if (isGenesis == 1) {
      // genesis tx data limit
      if (value == 0 && tokenID == GENESIS_TOKEN_ID) {
        Token.insertTokenIDOutput(tx.id, tokenID, [outputData], tasks, limit)
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
  for (input in validInputs) {
    let script = Buffer.from(input.script, 'hex')
    let value = Token.getTokenValue(script)
    let tokenID = Token.getTokenID(script)
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
      Token.insertTokenIDOutput(tx.id, tokenID, tokenIDOutputs[tokenID], tasks, limit)
    }
  }

  // check the genesis input
  for (tokenID in invalidTokenID) {
    // need to check if has genesis token 
    let scriptHash = tokenID
    for (input in validInputs) {
      let inputScriptHash = Buffer.from(bsv.crypto.Hash.sha256ripemd160(input.scriptHash))
      if (inputScriptHash.compare(scriptHash) == 0) {
        Token.insertTokenIDOutput(tx.id, tokenID, tokenIDOutputs[tokenID], tasks, limit)
      }
    }
  }

  if (tasks.length > 0) {
    flag = true
  }
  await Promise.all(tasks)

  return flag
}