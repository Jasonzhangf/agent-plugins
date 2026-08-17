const script = process.argv[2]
if (!script) throw new Error('pending-module requires a script name')
console.error(`[dsh-tui] ${script}: module implementation not admitted; runtime source absent by design`)
process.exit(2)
