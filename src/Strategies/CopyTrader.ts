
// TODO
// strategy that copies trades from another wolfbot instance (identified by ID, url,..)
// the main trader doesn't have to use wolfbot for trading
// this strategy just repeatedly queries the masters position size
// and then adjusts it's own position accordingly
// required input:
// - master bot ID/URL
// - master max capital (can be from wolfbot or adjusted?)
// - own trade balance for copy trader (as with any wolfbot trader)

// Advantages for mater: trades happen later, no front running. Additional liquidity following his direction
