import type { InfraProvider, ShoeboxConfig } from '../../config/schema.ts';

// Where apps deploy. Cloudflare wins when both providers are chosen: it hosts
// every app kind shoebox scaffolds (sites and the API worker), while AWS is
// then wired as a provider for resources the user adds by hand.
export const deployTarget = (
  config: ShoeboxConfig,
): InfraProvider | undefined => {
  if (config.infra.kind !== 'alchemy') return undefined;
  if (config.infra.providers.includes('cloudflare')) return 'cloudflare';
  if (config.infra.providers.includes('aws')) return 'aws';
  return undefined;
};
