const assert = require('assert')
const bsv = require('bsv')
const db = require('../db')
const config = require('../config_test.js')

const address = '1HSUUe1jTgBYBdzL22jQLoqK1AeSU7LPSu'
const walletId = 'test_walletId'

describe('address', function() {
    before(async function() {
        await db.init(config.db)
        await db.wallet.clear()
    });
    
    after(async function() {
        await db.wallet.clear()
        await db.exit()
    })

    it('should success', async function() {
        addr = bsv.Address.fromString(address)

        buf = addr.hashBuffer

        addr2 = bsv.Address.fromPublicKeyHash(buf)

        assert.strictEqual(addr2.toString(), address)

        const res = await db.wallet.insertAddress(buf, walletId)
        assert.strictEqual(res, true)

        let walletId2 = await db.wallet.getWalletId(buf)
        assert.strictEqual(walletId2, walletId)

    });
})
