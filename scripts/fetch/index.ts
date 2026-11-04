/** npm run map:fetch [-- --only=osm|linz] [--refresh]. A second run with a complete cache makes 0 network requests. */
import { fetchLinz, linzNetworkRequests } from './linz';
import { fetchOsm, osmNetworkRequests } from './overpass';

const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith('--only='))?.slice(7);
const refresh = args.includes('--refresh');

if (only && only !== 'osm' && only !== 'linz') throw new Error(`--only must be osm or linz, got ${only}`);
if (!only || only === 'linz') await fetchLinz(refresh);
if (!only || only === 'osm') await fetchOsm(refresh);
console.log(`map:fetch done, ${linzNetworkRequests() + osmNetworkRequests()} network requests`);
