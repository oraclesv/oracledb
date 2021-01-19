const proto = require('./protoheader')

const unique = module.exports

// unique speficic
// <type specific data> = <custom data> <custom data size(4 bytes)> + <uniqueID(36 bytes)> + <proto header>

const UNIQUE_ID_LEN = 36
const CUSTOM_DATA_SIZE_LEN = 4

const UNIQUE_ID_OFFSET = UNIQUE_ID_LEN + proto.getHeaderLen()
const CUSTOM_DATA_SIZE_OFFSET = CUSTOM_DATA_SIZE_LEN + UNIQUE_ID_OFFSET

unique.GENESIS_UNIQUE_ID = Buffer.alloc(UNIQUE_ID_LEN, 0)

unique.getUniqueID = function(script) {
    return script.subarray(script.length - UNIQUE_ID_OFFSET, script.length - UNIQUE_ID_OFFSET + UNIQUE_ID_LEN)
}

unique.getCustomDataSize = function(script) {
    return script.readUInt32LE(script.length - CUSTOM_DATA_SIZE_OFFSET)
}

unique.getCustomData = function(script) {
    customDataSize = unique.getCustomDataSize(script)
    return script.subarray(script.length - customDataSize - CUSTOM_DATA_SIZE_OFFSET, script.length - CUSTOM_DATA_SIZE_OFFSET)
}

unique.getFixHeaderLen = function() {
    return CUSTOM_DATA_SIZE_LEN
}

unique.getHeaderLen = function(script) {
    customDataSize = unique.getCustomDataSize(script)
    return customDataSize + CUSTOM_DATA_SIZE_OFFSET
}