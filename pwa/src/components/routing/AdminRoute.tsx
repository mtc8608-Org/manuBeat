// AdminRoute — a route that only admins can reach.
// - Not logged in → redirected to sign-in
// - Logged in but not admin → redirected to the landing page
// - Admin → renders the protected page normally
import React from 'react';
import { Redirect, Route, RouteProps } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { ROUTE } from '../../constants';

const AdminRoute: React.FC<RouteProps & { component: React.FC }> = ({ component: Component, ...rest }) => {
  const { token, isAdmin } = useAuth();
  return (
    <Route
      {...rest}
      render={() =>
        !token   ? <Redirect to={ROUTE.SIGNIN} /> :
        !isAdmin ? <Redirect to={ROUTE.LANDING} /> :
        <Component />
      }
    />
  );
};

export default AdminRoute;
