
import * as client from 'openid-client';
import {promisify} from 'util';
import createDebugLogger from 'debug';

const setTimeoutPromise = promisify(setTimeout);
const debug = createDebugLogger('@natlibfi/melinda-record-import-commons:keycloakAuthOperator');

export interface KeycloakOptions {
  test?: boolean;
  issuerBaseURL: string;
  serviceClientID: string;
  serviceClientSecret: string;
}

export interface ServiceTokenOperator {
  getServiceAuthToken(): Promise<string>;
}

export async function createServiceAuthoperator(keycloakOptions: KeycloakOptions): Promise<ServiceTokenOperator> {
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

  let serviceTokenSet: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers | undefined;
  const server = new URL(keycloakOptions.issuerBaseURL);
  const config = await client.discovery(server, keycloakOptions.serviceClientID, keycloakOptions.serviceClientSecret);

  return {getServiceAuthToken};

  async function getServiceAuthToken(): Promise<string> {
    if (!serviceTokenSet || serviceTokensRequireRefresh()) {
      await refreshServiceTokenSet();
      if (serviceTokenSet?.access_token === undefined) {
        throw new Error('Cant refresh access token!');
      }
      return serviceTokenSet.access_token;
    }

    return serviceTokenSet.access_token;

    function serviceTokensRequireRefresh(): boolean {
      if (!serviceTokenSet) {
        return true;
      }

      if (serviceTokenSet['expires_at'] === undefined && serviceTokenSet['expires_at'] === null) {
        debug('Invalid serviceTokenSet');
        return true;
      }

      const {expires_at} = serviceTokenSet;
      // @ts-expect-error expires_at cant be null
      const secondsToExpiration = expires_at - (Date.now() / 1000);
      return secondsToExpiration < 60;
    }

    async function refreshServiceTokenSet(): Promise<void> {
      debug('Auth serviceTokenSet refreshed');
      serviceTokenSet = await client.clientCredentialsGrant(
        config,
        {scope: 'melinda', resource: 'melinda'},
      );
    }
  }
}
