import packageJson from '../../package.json' with { type: 'json' };

export const cliVersion: string = packageJson.version;
