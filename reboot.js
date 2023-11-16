import { spawn, spawnSync } from 'child_process';

export const reboot = () => {
	const rebootCmd = spawnSync('sudo', ['/usr/sbin/reboot'], { stdio: ['inherit', 'inherit', 'pipe']});
	let result = ''

	if (rebootCmd.stderr) {
		console.log(rebootCmd.stderr.toString())
		result = 'failed'
	}

	if (rebootCmd.stdout) {
		console.log(rebootCmd.stdout.toString())
		result = 'success'
	}
	return result;
};