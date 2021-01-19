const assert = require('assert');
const config = require('../config_test.js')
const bsv = require('bsv')
const db = require('../src/db')
const oracle = require('../src/oracle')
const proto = require('../src/proto/protoheader')
const cache = require('../src/cache')

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

let curTx
const tokenValue = BigInt(1000000000000)

describe('token', function() {
  before(async function() {
    // runs once before the first test in this block
    await db.init(config.db)
  });

  after(async function() {
    // runs once after the last test in this block
    await db.exit()
  });

  beforeEach(async function() {
    await db.oracleUtxo.clear()
    cache.clear()
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

    const script = Buffer.concat([
      contractCode,
      contractHash,
      tokenName,
      tokenSymbol,
      genesisFlag, 
      decimalNum,
      Buffer.alloc(20, 0), // address
      Buffer.alloc(8, 0), // token value
      Buffer.alloc(20, 0), // script code hash
      tokenType, // type
      proto.PROTO_FLAG
    ])
    tx.addOutput(new bsv.Transaction.Output({
      script: bsv.Script.fromBuffer(script),
      satoshis: bsvBalance,
    }))

    const pres = await oracle.processTx(tx)
    assert.strictEqual(pres, true)
    curTx = tx

    console.log("cache: ", cache.data(), tx.id, typeof tx.id, cache.hasUtxo(tx.id, 0))
    assert.strictEqual(cache.hasUtxo(tx.id, 0), true)
  });

  afterEach(function() {
    // runs after each test in this block
  });

  // test cases
  it('genesis should return success', async function() {
    // find it in the utxo
    const res = await db.oracleUtxo.remove(curTx.id, 0)
    console.log("remove res:", res)
    assert.notStrictEqual(res, null)
    assert.strictEqual(res.txid.toString('hex'), curTx.id)
  });

  it('genesis should generate new token', async function() {
    const prevTx = curTx
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

    const scriptHash = Buffer.from(bsv.crypto.Hash.sha256ripemd160(curTx.outputs[0].script.toBuffer()))

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
      scriptHash, // script code hash
      tokenType, // type
      proto.PROTO_FLAG
    ])

    tx.addOutput(new bsv.Transaction.Output({
      script: bsv.Script.fromBuffer(script),
      satoshis: bsvBalance,
    }))

    const pres = await oracle.processTx(tx)
    assert.strictEqual(pres, true)
    assert.strictEqual(cache.hasUtxo(curTx.id, 0), false)

    curTx = tx

    //const res = await db.oracleUtxo.remove(curTx.id, 0)
    //console.log("remove res:", res)
    //assert.notStrictEqual(res, null)
    //assert.strictEqual(res.txid.toString('hex'), curTx.id)

    // token transfer
    const tx2 = new bsv.Transaction()
    tx2.addInput(new bsv.Transaction.Input({
      output: new bsv.Transaction.Output({
        script: curTx.outputs[0].script,
        satoshis: bsvBalance
      }),
      prevTxId: curTx.id,
      outputIndex: 0,
      script: bsv.Script.empty(), // placeholder
    }))

    const tokenValue2 = BigInt(100)
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
      scriptHash, // script code hash
      tokenType, // type
      proto.PROTO_FLAG
    ])

    tx2.addOutput(new bsv.Transaction.Output({
      script: bsv.Script.fromBuffer(script2),
      satoshis: bsvBalance,
    }))

    const buffValue3 = Buffer.alloc(8, 0)
    const tokenValue3 = tokenValue - tokenValue2
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
      scriptHash, // script code hash
      tokenType, // type
      proto.PROTO_FLAG
    ])
    tx2.addOutput(new bsv.Transaction.Output({
      script: bsv.Script.fromBuffer(script3),
      satoshis: bsvBalance,
    }))

    const pres2 = await oracle.processTx(tx2)
    assert.strictEqual(pres2, true)
    assert.strictEqual(cache.hasUtxo(curTx.id, 0), false)

    curTx = tx2
    assert.strictEqual(cache.hasUtxo(curTx.id, 0), true)
    assert.strictEqual(cache.hasUtxo(curTx.id, 1), true)

    const res2 = await db.oracleUtxo.remove(curTx.id, 0)
    assert.notStrictEqual(res2, null)
    assert.strictEqual(res2.txid.toString('hex'), curTx.id)
    assert.strictEqual(res2.tokenValue, tokenValue2)

    const res3 = await db.oracleUtxo.remove(curTx.id, 1)
    assert.notStrictEqual(res3, null)
    assert.strictEqual(res3.txid.toString('hex'), curTx.id)
    assert.strictEqual(res3.tokenValue, tokenValue3)
  })
})