const pLimit = require('p-limit')
const bsv = require('bsv')

const db = require('./db')
const config = require('../config.js')
const log = require('./logger').logger
const cache = require('./cache')
const TokenProto = require('./proto/tokenProto')

const token = module.exports

token.getHeaderLen = function(script) {
  return TokenProto.getHeaderLen()
}

token.checkContract = function(script, inputOracleData) {
  if (inputOracleData === undefined) {
    log.debug('checkContract failed with null inputOracleData')
    return false
  }
  const contractCode = TokenProto.getContractCode(script)
  const contractHash = TokenProto.getContractHash(script)
  const hash = bsv.crypto.Hash.sha256ripemd160(contractCode)
  if (contractHash.compare(hash) !== 0) {
    log.debug('checkContract failed with illegal contractHash')
    return false
  }

  // check input and output oracle data
  const oracleData = TokenProto.getOracleData(script)
  const address = TokenProto.getTokenAddress(script)
  const amount = TokenProto.getTokenAmount(script)
  const inputGenesisFlag = TokenProto.getGenesisFlag(inputOracleData)
  let newOracleData
  if (inputGenesisFlag === 1) {
    const tokenID = TokenProto.getTokenID(script)
    newOracleData = TokenProto.getNewTokenScriptFromGenesis(inputOracleData, address, amount, tokenID) 
    log.debug("token.checkContract: tokenID %s, address %s, amount %s", tokenID.toString('hex'), address.toString('hex'), amount)
  } else {
    newOracleData = TokenProto.getNewTokenScript(inputOracleData, address, amount) 
  }

  if (newOracleData.compare(oracleData) !== 0) {
    log.debug('checkContract failed with illegal oracleData %s, %s', newOracleData.toString('hex'), oracleData.toString('hex'))
    return false
  }

  return true
}

token.insertTokenIDOutput = function(txid, tokenID, outputs, tasks, limit) {
  log.debug('insertTokenIDOutput: txid %s, tokenID %s, outputs %s', txid, tokenID.toString('hex'), outputs)
  for (const outputData of outputs) {
    const outputIndex = outputData[0]
    const output = outputData[1]
    log.debug('insertTokenIDOutput: outputIndex %s, output %s', outputIndex, output)
    const script = output.script.toBuffer()
    const isGenesis = TokenProto.getGenesisFlag(script)
    const address = TokenProto.getTokenAddress(script)
    const data = {
      'txid': txid,
      'outputIndex': outputIndex,
      'script': script,
      'address': address,
      'tokenID': tokenID,
      'tokenValue': TokenProto.getTokenAmount(script),
      'decimalNum': TokenProto.getDecimalNum(script),
      'isGenesis': isGenesis,
      'type': TokenProto.PROTO_TYPE,
      'tokenName': TokenProto.getTokenName(script),
      'tokenSymbol': TokenProto.getTokenSymbol(script),
      'satoshis': BigInt(output.satoshis),
    }
    tasks.push(limit(async function() {
      // insert wallet id
      const walletId = await db.wallet.getWalletId(address)
      if (walletId !== null) {
        data['walletId'] = walletId
      }
      const res = await db.oracleUtxo.insert(data)
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

  // count the input token value
  const inValue = {}
  const inputTokenOracleData = {}
  for (const inputData of validInputs) {
    //const input = inputData[0]
    const script = inputData[1]
    log.debug('input script: %s, %s', script.length, script.toString('hex'))
    const value = TokenProto.getTokenAmount(script)
    const tokenID = TokenProto.getTokenID(script)
    let tokenIDHex = tokenID.toString('hex')
    if (inValue[tokenIDHex] === undefined) {
      inValue[tokenIDHex] = BigInt(0)
    }
    inValue[tokenIDHex] += value
    const genesisFlag = TokenProto.getGenesisFlag(script)
    if (genesisFlag === 1) {
      tokenIDHex = Buffer.from(bsv.crypto.Hash.sha256ripemd160(script)).toString('hex')
      log.debug('genesis calculate tokenID: %s', tokenIDHex)
    }
    inputTokenOracleData[tokenIDHex] = TokenProto.getOracleData(script)
  }

  log.debug('token.processTx: inputTokenOracleData %s', inputTokenOracleData)
  // count the output token value
  for (const outputData of validOutputs) {
    const output = outputData[1]
    const script = output.script.toBuffer()
    const value = TokenProto.getTokenAmount(script)
    const tokenID = TokenProto.getTokenID(script)
    const tokenIDHex = tokenID.toString('hex')
    const isGenesis = TokenProto.getGenesisFlag(script)
    const address = TokenProto.getTokenAddress(script)
    log.debug('token.processTx: output value %s, tokenID %s, isGenesis %s', value, tokenIDHex, isGenesis)
    if (isGenesis === 1) {
      // genesis tx data limit
      log.debug('token.processTx: check genesis args: %s, %s', outputData[0], outputData[1])
      if (value === BigInt(0) && tokenID.compare(TokenProto.GENESIS_TOKEN_ID) === 0 && address.compare(TokenProto.EMPTY_ADDRESS) === 0) {
        token.insertTokenIDOutput(tx.id, tokenID, [outputData], tasks, limit)
        const newTokenID = Buffer.from(bsv.crypto.Hash.sha256ripemd160(script))
        // try add new token ID
        db.tokenID.insert(newTokenID, TokenProto.getTokenName(script), TokenProto.getTokenSymbol(script))
      }
      continue
    }
    // check the contract code consistency
    if (token.checkContract(script, inputTokenOracleData[tokenIDHex]) === false) {
      continue
    }
    if (!outValue[tokenIDHex]) {
      outValue[tokenIDHex] = BigInt(0)
      tokenIDOutputs[tokenIDHex] = []
    }
    outValue[tokenIDHex] += value
    tokenIDOutputs[tokenIDHex].push(outputData)
  }

  // compare token input and output
  const invalidTokenID = []
  for (const tokenIDHex in outValue) {
    // check the contract code
    log.debug("token.processTx: validInputs %s, %s", tokenIDHex, validInputs[tokenIDHex])
    if (outValue[tokenIDHex] > inValue[tokenIDHex]) {
      invalidTokenID.push(tokenIDHex)
      log.info("token.processTx invalidTokenID %s, txid %s, outvalue %s, invalue %s", tokenIDHex, tx.id, outValue[tokenIDHex], inValue[tokenIDHex])
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