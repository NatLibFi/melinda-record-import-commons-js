
import * as client from 'openid-client';
import {promisify} from 'util';
import createDebugLogger from 'debug';

const setTimeoutPromise = promisify(setTimeout);
const debug = createDebugLogger('@natlibfi/melinda-record-import-commons:keycloakAuthOperator');

export async function createServiceAuthoperator(keycloakOptions) {
  if (keycloakOptions.test === true) {
    debug('Setting mock Auth tokens');
    await setTimeoutPromise(1);
    return {
      getServiceAuthToken: async () => {
        await setTimeoutPromise(2);
        return '123456789SecretTestToken!';
      }
    };
  }

  let serviceTokenSet;
  const server = new URL(keycloakOptions.issuerBaseURL);
  const config = await client.discovery(server, keycloakOptions.serviceClientID, keycloakOptions.serviceClientSecret);

  return {getServiceAuthToken};

  async function getServiceAuthToken() {
    if (!serviceTokenSet || serviceTokensRequireRefresh()) {
      await refreshServiceTokenSet();
      return serviceTokenSet.access_token;
    }

    return serviceTokenSet.access_token;

    function serviceTokensRequireRefresh() {
      const mandatoryAttributes = ['expires_at'];
      if (!mandatoryAttributes.every(attr => Object.keys(serviceTokenSet).includes(attr))) {
        debug('Invalid serviceTokenSet');
        return true;
      }

      const {expires_at} = serviceTokenSet;
      const secondsToExpiration = expires_at - (Date.now() / 1000);
      return secondsToExpiration < 60;
    }

    async function refreshServiceTokenSet() {
      debug('Auth serviceTokenSet refreshed');
      serviceTokenSet = await client.clientCredentialsGrant(
        config,
        {scope: 'melinda', resource: 'melinda'},
      );
    }
  }
}
