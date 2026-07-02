// UserRoute — a route that only full users (role 'user' or 'admin') can reach.
// - Not logged in → redirected to sign-in
// - Logged in but only 'registered' → redirected to the landing page
// - User/admin → renders the protected page normally
import React from 'react';
import { Redirect, Route, RouteProps } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { ROUTE } from '../../constants';

const UserRoute: React.FC<RouteProps & { component: React.FC }> = ({ component: Component, ...rest }) => {
  const { token, isUser } = useAuth();
  return (
    <Route
      {...rest}
      render={() =>
        !token  ? <Redirect to={ROUTE.SIGNIN} /> :
        !isUser ? <Redirect to={ROUTE.LANDING} /> :
        <Component />
      }
    />
  );
};

export default UserRoute;
