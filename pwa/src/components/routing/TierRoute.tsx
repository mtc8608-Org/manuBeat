// TierRoute — a route gated on a minimum rung of the ROLE_TIERS ladder.
// - Not logged in            → redirected to sign-in
// - Logged in, rung too low  → redirected to the landing page
// - Rung at or above minTier → renders the protected page normally
//
// This is the routing counterpart of the nav filtering in AppHeader/Menu: both
// ask AuthContext's hasTier, so a page and its nav link appear and disappear
// together. Gate on the rung permissions.js requires for the page's operations.
//
// Like the nav filter, this is presentation, NOT enforcement — it decides which
// component mounts in this browser, nothing more. The operations behind the page
// are gated server-side by permissions.js, and must stay so.
import React from 'react';
import { Redirect, Route, RouteProps } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { ROUTE, RoleTier } from '../../constants';

export type TierRouteProps = RouteProps & {
  component: React.FC;
  /** Minimum rung that may reach the route. */
  minTier: RoleTier;
};

const TierRoute: React.FC<TierRouteProps> = ({ component: Component, minTier, ...rest }) => {
  const { token, hasTier } = useAuth();
  return (
    <Route
      {...rest}
      render={() =>
        !token             ? <Redirect to={ROUTE.SIGNIN} /> :
        !hasTier(minTier)  ? <Redirect to={ROUTE.LANDING} /> :
        <Component />
      }
    />
  );
};

export default TierRoute;
