const Filter = require('./bitdb.json')
const Db = require('./db')
/**
* Return the last synchronized checkpoint
*/

let height = Filter.from

const checkpoint = function() {
  return height
}
const updateHeight = async function(index) {
  await Db.info.updateHeight(index)
  height = index
  console.log('updateHeight:', height)
}
module.exports = {
  checkpoint: checkpoint,
  updateHeight: updateHeight,
}
