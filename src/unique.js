const logger = require('./logger')
const UniqueProto = require('./proto/uniqueProto')

const unique = module.exports

unique.getHeaderLen = function(script) {
  fixLen = unique.getFixHeaderLen()
  if (fixLen > script.length) {
    return 0
  }
  return UniqueProto.getHeaderLen(script)
}

unique.insertUniqueIDOutput = function(txId, uniqueID, outputData, tasks, limit) {
  log.debug('insertUniqueIDOutput: txid %s, uniqueID %s, outputs %s', txid, uniqueID.toString('hex'), output)
  const outputIndex = outputData[0]
  const output = outputData[1]
  log.debug('insertTokenIDOutput: outputIndex %s, output %s', outputIndex, output)
  const script = output.script.toBuffer()
  const isGenesis = UniqueProto.getGenesisFlag(script)
  const data = {
    'txid': txid,
    'outputIndex': outputIndex,
    'script': script,
    'satoshis': BigInt(output.satoshis),
    'uniqueID': uniqueID,
    'isGenesis': isGenesis,
    'type': UniqueProto.PROTO_TYPE,
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

unique.processTx = async function(tx, validInputs, validOutputs) {

  let flag = false

  const tasks = []
  const limit = pLimit(config.db.max_concurrency)
  let uniqueOutpus = {}
  let blackList = {}
  for (const outputData of validOutputs) {
    const output = outputData[1]
    const script = output.script.toBuffer()
    const uniqueID = UniqueProto.getUniqueID(script)
    const uniqueIDHex = uniqueID.toString('hex')
    const isGenesis = UniqueProto.getGenesisFlag(script)
    log.debug('unique.processTx: output, uniqueID %s, isGenesis %s', uniqueIDHex, isGenesis)

    if (blackList[uniqueIDHex] !== undefined) {
      continue
    }
    if (isGenesis === 1) {
      // genesis tx data limit
      log.debug('unique.processTx: check genesis args: %s, %s', outputData[0], outputData[1])
      if (uniqueID.compare(UniqueProto.GENESIS_UNIQUE_ID) === 0) {
        unique.insertUniqueIDOutput(tx.id, uniqueID, outputData, tasks, limit)
      }
      continue
    }
    // the tx has more than one outputs with the same uniqueID
    if (uniqueOutpus[uniqueIDHex] !== undefined) {
      delete uniqueOutpus[uniqueIDHex]
      blackList[uniqueIDHex] = 1
    } else {
      uniqueOutpus[uniqueIDHex] = outputData
    }
  }

  let uniqueInputs = {}
  for (const inputData of validInputs) {
    // script is buffer type
    const script = inputData[1]
    const uniqueID = UniqueProto.getUniqueID(script)
    const uniqueIDHex = uniqueID.toString('hex')
    uniqueInputs[uniqueIDHex] = inputData
  }

  let invalidUniqueIDs = {}
  for (const uniqueIDHex in uniqueOutpus) {
    if (uniqueInputs[uniqueIDHex] !== undefined) {
      unique.insertUniqueIDOutput(tx.id, Buffer.from(uniqueIDHex, 'hex'), uniqueOutpus[uniqueIDHex], tasks, limit)
    } else {
      invalidUniqueIDs.push(uniqueIDHex)
      log.info("unique.processTx invalidUniqueID %s, txid %s", uniqueIDHex, tx.id)
    }
  }

  for (const uniqueIDHex of invalieUniqueIDs) {
    for (const inputData of validInputs) {
      const prevTxId = inputData
      const prevOutputIndex = 0

      const outputIndexBuf = Buffer.alloc(4, 0)
      outputIndexBuf.writeUInt32BE(prevOutputIndex)
      const inputUniqueID = Buffer.concat([
        Buffer.from(prevTxId, 'hex'), 
        outputIndexBuf
      ])

      if (inputUniqueID.toString('hex') === uniqueIDHex) {
        log.info('unique.processTx: genesis tx')
        unique.insertUniqueIDOutput(tx.id, inputUniqueID, uniqueIDOutput[uniqueIDHex], tasks, limit)
      }
    }
  }

  if (tasks.length > 0) {
    flag = true
    const res = await Promise.all(tasks)
    log.debug('unique.processTx insert res: %s', res)
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