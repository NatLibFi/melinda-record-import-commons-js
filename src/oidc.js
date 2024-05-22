/* eslint-disable camelcase */
import {Issuer} from 'openid-client';
import {promisify} from 'util';

const setTimeoutPromise = promisify(setTimeout);


export async function createServiceAuthoperator(keycloakOptions) {
  if (keycloakOptions.test === true) {
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
      const mandatoryAttributes = ['refresh_token', 'expires_at'];
      if (!mandatoryAttributes.every(attr => Object.keys(serviceTokenSet).includes(attr))) {
        return true;
      }

      const {expires_at} = serviceTokenSet;
      const secondsToExpiration = expires_at - (Date.now() / 1000); // eslint-disable-line no-extra-parens
      return secondsToExpiration < 60;
    }

    async function refreshServiceTokenSet() {
      serviceTokenSet = await serviceClient.grant({grant_type: 'client_credentials'});
    }
  }
}
