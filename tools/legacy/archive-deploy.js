// Disabled historical entrypoint. Prior implementation remains in Git history.
// A recursive repository archive could leak deployment secrets and private data.
console.error(
  'Legacy deployment archive is disabled: no archive was created or changed. ' +
  'Use the Docker deployment workflow and the private backup/restore guidance ' +
  'in DEPLOYMENT.md (备份与恢复). Never distribute deployment secrets or private data.'
);
process.exitCode = 1;
