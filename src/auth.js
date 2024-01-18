import Keycloak from 'keycloak-connect';

export default function (keycloakConfig) {
  if (keycloakConfig.test === true) {
    return {getGrant: getGrantTest, verifyGrant: verifyGrantTest};
  }
  /* istanbul ignore next */
  const keycloak = new Keycloak({}, keycloakConfig);
  // keycloak.grantManager

  /* istanbul ignore next */
  return {getGrant, verifyGrant};

  /* istanbul ignore next */
  async function getGrant({username, password}) {
    const grant = await keycloak.grantManager.obtainDirectly(username, password);
    return grant;
  }

  function getGrantTest({username, password}) {
    if (username === 'foo' && password === 'bar') {
      return {access_token: '0-0-0'}; // eslint-disable-line camelcase
    }

    throw new Error('Wrong Test username / password');
  }

  /* istanbul ignore next */
  function verifyGrant(grant) {
    keycloak.grantManager.validateGrant(grant);
    return true;
  }

  function verifyGrantTest(grant) {
    if (grant.access_token === '0-0-0') {
      return true;
    }

    return false;
  }
}
