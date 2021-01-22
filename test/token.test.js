const assert = require('assert');
const config = require('../config_test.js')
const bsv = require('bsv')
const db = require('../src/db')
const oracle = require('../src/oracle')
const proto = require('../src/proto/protoheader')
const cache = require('../src/cache')
const log = require('../src/logger').logger

// first case: genesis tx

const contractCode = Buffer.from('contract code test')
const contractHash = bsv.crypto.Hash.sha256ripemd160(contractCode)
const tokenType = Buffer.allocUnsafe(4)
tokenType.writeUInt32LE(1)
const tokenSymbol = Buffer.alloc(10, 0)
tokenSymbol.write('ttn')
const tokenName = Buffer.alloc(20, 0)
tokenName.write('test token name')
const txid = "b145b31e2b1b24103b0fc8f4b9e54953f5b90f9059559dd7612c629897b95820"
const bsvBalance = 100
const address = Buffer.from('ce0b4a25ec9a7db3ad28cf824aa624125ea8143d', 'hex')
const decimalNum = Buffer.from('08', 'hex')
const genesisFlag = Buffer.from('01', 'hex')
const nonGenesisFlag = Buffer.from('00', 'hex')

const tokenValue = BigInt(1000000000000)
let tokenID
let tokenValue2, tokenValue3

async function genGenesis(tokenAddress=null, tokenAmount=null, tokenID=null) {
  // runs before each test in this block
  const tx = new bsv.Transaction()
  tx.addInput(new bsv.Transaction.Input({
    output: new bsv.Transaction.Output({
      script: bsv.Script.empty(),
      satoshis: bsvBalance
    }),
    prevTxId: txid,
    outputIndex: 0,
    script: bsv.Script.empty(), // placeholder
  }))

  if (tokenAddress === null) {
    tokenAddress = Buffer.alloc(20, 0)
  }
  if (tokenAmount === null) {
    tokenAmount = Buffer.alloc(8, 0)
  }
  if (tokenID == null) {
    tokenID = Buffer.alloc(20, 0)
  }

  const script = Buffer.concat([
    contractCode,
    contractHash,
    tokenName,
    tokenSymbol,
    genesisFlag, 
    decimalNum,
    tokenAddress,
    tokenAmount,
    tokenID,
    tokenType, // type
    proto.PROTO_FLAG
  ])
  tx.addOutput(new bsv.Transaction.Output({
    script: bsv.Script.fromBuffer(script),
    satoshis: bsvBalance,
  }))

  return tx
}

async function genToken(genesisTx) {
  const prevTx = genesisTx
  const tx = new bsv.Transaction()
  tx.addInput(new bsv.Transaction.Input({
    output: new bsv.Transaction.Output({
      script: prevTx.outputs[0].script,
      satoshis: bsvBalance
    }),
    prevTxId: prevTx.id,
    outputIndex: 0,
    script: bsv.Script.empty(), // placeholder
  }))

  tokenID = Buffer.from(bsv.crypto.Hash.sha256ripemd160(genesisTx.outputs[0].script.toBuffer()))

  const buffValue = Buffer.alloc(8, 0)
  buffValue.writeBigUInt64LE(tokenValue)
  const script = Buffer.concat([
    contractCode,
    contractHash,
    tokenName,
    tokenSymbol,
    nonGenesisFlag, // genesis flag
    decimalNum,
    address, // address
    buffValue, // token value
    tokenID, // tokenID
    tokenType, // type
    proto.PROTO_FLAG
  ])

  tx.addOutput(new bsv.Transaction.Output({
    script: bsv.Script.fromBuffer(script),
    satoshis: bsvBalance,
  }))

  const pres = await oracle.processTx(tx)
  assert.strictEqual(pres, true)
  assert.strictEqual(cache.hasUtxo(genesisTx.id, 0), false)

  return tx
}

async function genTokenTransfer(tokenTx, add=0) {
  // token transfer
  const tx = new bsv.Transaction()
  tx.addInput(new bsv.Transaction.Input({
    output: new bsv.Transaction.Output({
      script: tokenTx.outputs[0].script,
      satoshis: bsvBalance
    }),
    prevTxId: tokenTx.id,
    outputIndex: 0,
    script: bsv.Script.empty(), // placeholder
  }))

  tokenValue2 = BigInt(100)
  const buffValue2 = Buffer.alloc(8, 0)
  buffValue2.writeBigUInt64LE(tokenValue2)
  const script2 = Buffer.concat([
    contractCode,
    contractHash,
    tokenName,
    tokenSymbol,
    nonGenesisFlag, // genesis flag
    decimalNum,
    address, // address
    buffValue2, // token value
    tokenID, 
    tokenType, // type
    proto.PROTO_FLAG
  ])

  tx.addOutput(new bsv.Transaction.Output({
    script: bsv.Script.fromBuffer(script2),
    satoshis: bsvBalance,
  }))

  const buffValue3 = Buffer.alloc(8, 0)
  tokenValue3 = tokenValue - tokenValue2 + BigInt(add)
  buffValue3.writeBigUInt64LE(tokenValue3)
  const script3 = Buffer.concat([
    contractCode,
    contractHash,
    tokenName,
    tokenSymbol,
    nonGenesisFlag, // genesis flag
    decimalNum,
    address, // address
    buffValue3, // token value
    tokenID,
    tokenType, // type
    proto.PROTO_FLAG
  ])
  tx.addOutput(new bsv.Transaction.Output({
    script: bsv.Script.fromBuffer(script3),
    satoshis: bsvBalance,
  }))
  return tx
}

describe('token', function() {
  before(async function() {
    // runs once before the first test in this block
    await db.init(config.db)
    await db.createIndex()
  });

  after(async function() {
    // runs once after the last test in this block
    await db.exit()
  });

  beforeEach(async function() {
    log.debug("---------------------start test---------------")
    await db.oracleUtxo.clear()
    await db.tokenID.clear()
    cache.clear()
  });

  afterEach(function() {
    // runs after each test in this block
    log.debug("---------------------end test---------------")
  });

  // test cases
  it('should success with genesis tx', async function() {
    const genesisTx = await genGenesis()
    const pres = await oracle.processTx(genesisTx)
    assert.strictEqual(pres, true)
    assert.strictEqual(cache.hasUtxo(genesisTx.id, 0), true)

    // check tokenID collection
    tokenID = Buffer.from(bsv.crypto.Hash.sha256ripemd160(genesisTx.outputs[0].script.toBuffer()))
    const tokenIDRes = await db.tokenID.findOne(tokenID)
    assert.strictEqual(tokenIDRes.tokenID.compare(tokenID), 0)

    const res = await db.oracleUtxo.remove(genesisTx.id, 0)
    //console.log("remove res:", res)
    assert.notStrictEqual(res, null)
    assert.strictEqual(res.txid.toString('hex'), genesisTx.id)
  });

  it('should failed with wrong genesis address', async function() {
    const genesisTx = await genGenesis(tokenAddress=address)
    const pres = await oracle.processTx(genesisTx)

    assert.strictEqual(pres, false)

    assert.strictEqual(cache.hasUtxo(genesisTx.id, 0), false)
    const res = await db.oracleUtxo.remove(genesisTx.id, 0)
    assert.strictEqual(res, null)
  });

  it('should failed with wrong genesis token amount', async function() {
    const amountBuf = Buffer.alloc(8, 0)
    amountBuf.writeBigUInt64LE(BigInt(1))
    const genesisTx = await genGenesis(tokenAmount=amountBuf)
    const pres = await oracle.processTx(genesisTx)

    assert.strictEqual(pres, false)

    assert.strictEqual(cache.hasUtxo(genesisTx.id, 0), false)
    const res = await db.oracleUtxo.remove(genesisTx.id, 0)
    assert.strictEqual(res, null)
  });

  it('should failed with wrong genesis token id', async function() {
    const testID = Buffer.alloc(20, 0)
    testID.write('test id')
    const genesisTx = await genGenesis(tokenID=testID)
    const pres = await oracle.processTx(genesisTx)

    assert.strictEqual(pres, false)

    assert.strictEqual(cache.hasUtxo(genesisTx.id, 0), false)
    const res = await db.oracleUtxo.remove(genesisTx.id, 0)
    assert.strictEqual(res, null)
  });

  it('should success when input token amount equal output token amount', async function() {

    const genesisTx = await genGenesis()
    await oracle.processTx(genesisTx)
    const tokenTx = await genToken(genesisTx)

    const transferTx = await genTokenTransfer(tokenTx)

    let res = await oracle.processTx(transferTx)
    assert.strictEqual(res, true)
    assert.strictEqual(cache.hasUtxo(tokenTx.id, 0), false)

    assert.strictEqual(cache.hasUtxo(transferTx.id, 0), true)
    assert.strictEqual(cache.hasUtxo(transferTx.id, 1), true)

    res = await db.oracleUtxo.getAddressTokenUtxos(address, tokenID)
    log.debug('getAddressTokenUtxos: res %s', res)
    assert.strictEqual(res.length, 2)
    const tokenIDInfos = cache.getAllTokenIDInfo()
    //assert.strictEqual(Object.keys(tokenIDInfos).length, 1)
    assert.strictEqual(tokenIDInfos[tokenID.toString('hex')].name, tokenName.toString('hex'))
    assert.strictEqual(tokenIDInfos[tokenID.toString('hex')].symbol, tokenSymbol.toString('hex'))

    const res2 = await db.oracleUtxo.remove(transferTx.id, 0)
    assert.notStrictEqual(res2, null)
    assert.strictEqual(res2.txid.toString('hex'), transferTx.id)
    assert.strictEqual(res2.tokenValue, tokenValue2)
    // verify the res data
    assert.strictEqual(res2.satoshis, BigInt(bsvBalance))
    assert.strictEqual(res2.tokenID.compare(tokenID), 0)
    assert.strictEqual(res2.tokenName.compare(tokenName), 0)
    assert.strictEqual(res2.tokenSymbol.compare(tokenSymbol),0)
    assert.strictEqual(res2.address.compare(address), 0)
    assert.strictEqual(res2.type, 1)

    const res3 = await db.oracleUtxo.remove(transferTx.id, 1)
    assert.notStrictEqual(res3, null)
    assert.strictEqual(res3.txid.toString('hex'), transferTx.id)
    assert.strictEqual(res3.tokenValue, tokenValue3)
  })

  it('should success when input token amount greater then output token amount', async function() {

    const genesisTx = await genGenesis()
    await oracle.processTx(genesisTx)
    const tokenTx = await genToken(genesisTx)

    const transferTx = await genTokenTransfer(tokenTx, add=-10)

    const res = await oracle.processTx(transferTx)
    assert.strictEqual(res, true)
    assert.strictEqual(cache.hasUtxo(tokenTx.id, 0), false)

    assert.strictEqual(cache.hasUtxo(transferTx.id, 0), true)
    assert.strictEqual(cache.hasUtxo(transferTx.id, 1), true)

    const res2 = await db.oracleUtxo.remove(transferTx.id, 0)
    assert.notStrictEqual(res2, null)
    assert.strictEqual(res2.txid.toString('hex'), transferTx.id)
    assert.strictEqual(res2.tokenValue, tokenValue2)

    const res3 = await db.oracleUtxo.remove(transferTx.id, 1)
    assert.notStrictEqual(res3, null)
    assert.strictEqual(res3.txid.toString('hex'), transferTx.id)
    assert.strictEqual(res3.tokenValue, tokenValue3)
  })

  it('should failed when input token less than output token', async function() {
    const genesisTx = await genGenesis()
    await oracle.processTx(genesisTx)
    const tokenTx = await genToken(genesisTx)

    const transferTx = await genTokenTransfer(tokenTx, add=10)
    const res = await oracle.processTx(transferTx)
    assert.strictEqual(res, true)
    assert.strictEqual(cache.hasUtxo(tokenTx.id, 0), false)

    assert.strictEqual(cache.hasUtxo(transferTx.id, 0), false)
    assert.strictEqual(cache.hasUtxo(transferTx.id, 1), false)

    const res2 = await db.oracleUtxo.remove(transferTx.id, 0)
    assert.strictEqual(res2, null)

    const res3 = await db.oracleUtxo.remove(transferTx.id, 1)
    assert.strictEqual(res3, null)
  })

  it('should failed with no token input', async function() {

    const tx = new bsv.Transaction()
    tx.addInput(new bsv.Transaction.Input({
      output: new bsv.Transaction.Output({
        script: bsv.Script.empty(),
        satoshis: bsvBalance
      }),
      prevTxId: txid,
      outputIndex: 0,
      script: bsv.Script.empty(), // placeholder
    }))

    const buffValue = Buffer.alloc(8, 0)
    buffValue.writeBigUInt64LE(tokenValue)
    const script = Buffer.concat([
      contractCode,
      contractHash,
      tokenName,
      tokenSymbol,
      nonGenesisFlag, // genesis flag
      decimalNum,
      address, // address
      buffValue, // token value
      tokenID, // tokenID
      tokenType, // type
      proto.PROTO_FLAG
    ])

    tx.addOutput(new bsv.Transaction.Output({
      script: bsv.Script.fromBuffer(script),
      satoshis: bsvBalance,
    }))

    const res = await oracle.processTx(tx)
    assert.strictEqual(res, false)
  })

  it('should failed when input token is forged', async function() {

    const tokenTx = new bsv.Transaction()
    tokenTx.addInput(new bsv.Transaction.Input({
      output: new bsv.Transaction.Output({
        script: bsv.Script.empty(),
        satoshis: bsvBalance
      }),
      prevTxId: txid,
      outputIndex: 0,
      script: bsv.Script.empty(), // placeholder
    }))

    const buffValue = Buffer.alloc(8, 0)
    buffValue.writeBigUInt64LE(tokenValue)
    const script = Buffer.concat([
      contractCode,
      contractHash,
      tokenName,
      tokenSymbol,
      nonGenesisFlag, // genesis flag
      decimalNum,
      address, // address
      buffValue, // token value
      tokenID, // tokenID
      tokenType, // type
      proto.PROTO_FLAG
    ])

    tokenTx.addOutput(new bsv.Transaction.Output({
      script: bsv.Script.fromBuffer(script),
      satoshis: bsvBalance,
    }))

    const transferTx = await genTokenTransfer(tokenTx)

    const res = await oracle.processTx(transferTx)
    assert.strictEqual(res, false)

    assert.strictEqual(cache.hasUtxo(transferTx.id, 0), false)
    assert.strictEqual(cache.hasUtxo(transferTx.id, 1), false)

    const res2 = await db.oracleUtxo.remove(transferTx.id, 0)
    assert.strictEqual(res2, null)

    const res3 = await db.oracleUtxo.remove(transferTx.id, 1)
    assert.strictEqual(res3, null)
  })

  // TODO: multi tokenID inputs 
})