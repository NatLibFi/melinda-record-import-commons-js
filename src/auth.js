import Keycloak from 'keycloak-connect';
import createDebugLogger from 'debug';

export default function (keycloakConfig) {
  const debug = createDebugLogger('@natlibfi/melinda-record-import-commons:auth:dev');

  if (keycloakConfig.test === true) {
    debug('Initiating test auth');
    return {getGrant: getGrantTest, verifyGrant: verifyGrantTest};
  }
  /* istanbul ignore next */
  const keycloak = new Keycloak({}, keycloakConfig);
  // keycloak.grantManager

  /* istanbul ignore next */
  return {getGrant, verifyGrant};

  /* istanbul ignore next */
  async function getGrant({username, password}) {
    debug('Getting grant');
    const grant = await keycloak.grantManager.obtainDirectly(username, password);
    debug(`Grant: ${JSON.stringify(grant)}`);
    return grant;
  }

  function getGrantTest({username, password}) {
    if (username === 'foo' && password === 'bar') {
      return {access_token: {token: '0-0-0'}}; // eslint-disable-line camelcase
    }

    throw new Error('Wrong Test username / password');
  }

  /* istanbul ignore next */
  async function verifyGrant(grant) {
    debug('Verifying grant');
    await keycloak.grantManager.validateGrant(grant);
    return true;
  }

  function verifyGrantTest(grant) {
    if (grant.access_token.token === '0-0-0') {
      return true;
    }

    return false;
  }
}
