const chai = require('chai')
const chaiHttp = require('chai-http')
const bsv = require('bsv')
const server = require('../src/server')
const should = chai.should()
const config = require('../config_test')
const db = require('../src/db')
const TokenProto = require('../src/proto/tokenProto')
const cache = require('../src/cache')

chai.use(chaiHttp)

const app = server.app

const tokenID = Buffer.alloc(20, 0)
tokenID.write('test token ID')
const tokenName = Buffer.alloc(20, 0)
tokenName.write('test token name')
const tokenSymbol = Buffer.alloc(20, 0)
tokenSymbol.write('ttn')

const txid = "b145b31e2b1b24103b0fc8f4b9e54953f5b90f9059559dd7612c629897b95820"
const address = bsv.Address.fromString('msREe5jsynP65899v1KJCydf6Sc9pJPb8S')

async function insertToken() {
  const data = {
    'txid': txid,
    'outputIndex': 0,
    'script': bsv.Script.empty().toBuffer(),
    'address': address.hashBuffer,
    'tokenID': tokenID,
    'tokenValue': BigInt(100),
    'decimalNum': 1,
    'isGenesis': 0,
    'type': TokenProto.PROTO_TYPE,
    'tokenName': tokenName,
    'tokenSymbol': tokenSymbol,
    'satoshis': BigInt(1000),
  }
  await db.oracleUtxo.insert(data)
}

describe('APP', function() {
  before(async function() {
    server.start(config.http, config.rabin)
    await db.init(config.db)
    await db.createIndex()
    //await db.tokenID.insert(tokenID, tokenName.toString(), tokenSymbol.toString())
    cache.addTokenIDInfo(tokenID, tokenName.toString(), tokenSymbol.toString())
    await insertToken() 
  })

  after(async function() {
    await server.close()
    await db.oracleUtxo.clear()
    await db.exit()
  })

  it('should success', (done) => {
    chai.request(app)
    .get('/')
    .end((err, res) => {
      res.should.have.status(200)
      res.body.ok.should.equal(1)
      done()
    })
  })

  it('/get_tokenid_list', (done) => {
    chai.request(app).get('/get_tokenid_list').end((err, res) => {
      console.log('res:', res.body.res)
      res.should.have.status(200)
      res.body.ok.should.equal(1)
      //res.body.res.should.have.lengthOf(1)
      res.body.res[tokenID].name.should.equal(tokenName.toString())
      res.body.res[tokenID].symbol.should.equal(tokenSymbol.toString())
      done()
    })
  })

  it('/get_token_utxos', (done) => {
    chai.request(app).get('/get_token_utxos').query({'address': address.toString(), 'tokenid': tokenID.toString('hex')}).end((err, res) => {
      console.log('res:', res.body)
      res.should.have.status(200)
      res.body.ok.should.equal(1)
      res.body.res.should.have.lengthOf(1)
      res.body.res[0].txid.should.equal(txid)
      res.body.res[0].outputIndex.should.equal(0)
      res.body.res[0].satoshis.should.equal('1000')
      done()
    })
  })

  it('/get_token_utxo_rabin_sig', (done) => {
    chai.request(app).get('/get_token_utxo_rabin_sig').query({'txid': txid, 'outputindex': 0}).end((err, res) => {
      console.log('res:', res.body)
      res.should.have.status(200)
      res.body.ok.should.equal(1)
      done()
    })
  })

})