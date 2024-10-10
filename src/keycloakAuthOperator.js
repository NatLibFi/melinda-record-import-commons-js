/* eslint-disable camelcase */
import {Issuer} from 'openid-client';
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

  let serviceTokenSet; // eslint-disable-line functional/no-let

  const keycloakIssuer = await getIssuer(keycloakOptions.issuerBaseURL);

  const serviceClient = new keycloakIssuer.Client({
    client_id: keycloakOptions.serviceClientID,
    client_secret: keycloakOptions.serviceClientSecret
  });

  return {getServiceAuthToken};

  function getIssuer(uri) {
    return Issuer.discover(uri);
  }

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
      const secondsToExpiration = expires_at - (Date.now() / 1000); // eslint-disable-line no-extra-parens
      return secondsToExpiration < 60;
    }

    async function refreshServiceTokenSet() {
      debug('Auth serviceTokenSet refreshed');
      serviceTokenSet = await serviceClient.grant({grant_type: 'client_credentials'});
    }
  }
}
