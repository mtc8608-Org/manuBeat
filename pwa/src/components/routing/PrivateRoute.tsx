// PrivateRoute — a route that requires a login session.
// - Not logged in → redirected to sign-in
// - Logged in → renders the protected page normally
import React from 'react';
import { Redirect, Route, RouteProps } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { ROUTE } from '../../constants';

const PrivateRoute: React.FC<RouteProps & { component: React.FC }> = ({ component: Component, ...rest }) => {
  const { token } = useAuth();
  return (
    <Route
      {...rest}
      render={() => token ? <Component /> : <Redirect to={ROUTE.SIGNIN} />}
    />
  );
};

export default PrivateRoute;
