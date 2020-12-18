const assert = require('assert');
const config = require('../config.js')
const bsv = require('bsv')
const db = require('../db')
const backtrace = require('../backtrace')
const proto = require('../protoheader')

// first case: genesis tx

const tokenType = Buffer.allocUnsafe(4)
tokenType.writeUInt32LE(1)
const txid = "b145b31e2b1b24103b0fc8f4b9e54953f5b90f9059559dd7612c629897b95820"

let curTx

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
    // runs before each test in this block
  });

  afterEach(function() {
    // runs after each test in this block
    const bsvBalance = 100
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
      Buffer.from('01', 'hex'), // genesis flag
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

    const pres = await backtrace.processTx(tx)
    assert.strictEqual(pres, true)
    curTx = tx
  });

  // test cases
  it('genesis should return success', async function() {
    // find it in the utxo
    const res = await db.utxo.remove(curTx.id, 0)
    console.log("remove res:", res)
    assert.strictEqual(res.ok, 1)
    assert.strictEqual(res.value.txid, curTx.id)
  })
})