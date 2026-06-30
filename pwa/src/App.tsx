import React from 'react';
import { IonApp, IonRouterOutlet, IonSplitPane, setupIonicReact } from '@ionic/react';
import { ThemeProvider } from './contexts/ThemeContext';
import { AuthProvider } from './contexts/AuthContext';
import { IonReactRouter } from '@ionic/react-router';
import { Route } from 'react-router-dom';
import Menu from './components/shell/Menu';
import PrivateRoute from './components/routing/PrivateRoute';
import AdminRoute from './components/routing/AdminRoute';
import Landing from './pages/public/Landing';
import SignIn from './pages/public/SignIn';
import Account from './pages/Account';
import Surveys from './pages/surveys/Surveys';
import Content from './pages/backoffice/Content';
import Files from './pages/backoffice/Files';
import Configuration from './pages/backoffice/Configuration';
import Simulator from './pages/models/Simulator';
import ModelSandbox from './pages/models/ModelSandbox';
import PlotSandbox from './pages/models/PlotSandbox';
import ProcessingSandbox from './pages/models/ProcessingSandbox';
import HdfInspector from './pages/models/HdfInspector';
import Patients from './pages/bedside/Patients';
import Devices from './pages/bedside/Devices';
import Monitor from './pages/bedside/Monitor';
import { ROUTE } from './constants';

/* Core CSS required for Ionic components to work properly */
import '@ionic/react/css/core.css';

/* Basic CSS for apps built with Ionic */
import '@ionic/react/css/normalize.css';
import '@ionic/react/css/structure.css';
import '@ionic/react/css/typography.css';

/* Optional CSS utils that can be commented out */
import '@ionic/react/css/padding.css';
import '@ionic/react/css/float-elements.css';
import '@ionic/react/css/text-alignment.css';
import '@ionic/react/css/text-transformation.css';
import '@ionic/react/css/flex-utils.css';
import '@ionic/react/css/display.css';

/* Theme variables */
import './theme/variables.css';

setupIonicReact();

const App: React.FC = () => {
  return (
    <ThemeProvider>
      <AuthProvider>
        <IonApp>
          <IonReactRouter>
            <IonSplitPane when="(min-width: 3000px)" contentId="main">
              <Menu />
              <IonRouterOutlet id="main">
                {/* Public */}
                <Route path={ROUTE.LANDING} exact={true} component={Landing} />
                <Route path={ROUTE.SIGNIN}  exact={true} component={SignIn} />

                {/* Authenticated */}
                <PrivateRoute path={ROUTE.ACCOUNT}  exact={true} component={Account} />
                <PrivateRoute path={ROUTE.SURVEYS}  exact={true} component={Surveys} />

                {/* [MEDICAL] Physiology Simulator */}
                <PrivateRoute path={ROUTE.SIMULATOR}     exact={true} component={Simulator} />
                <PrivateRoute path={ROUTE.MODEL_SANDBOX} exact={true} component={ModelSandbox} />
                <PrivateRoute path={ROUTE.PLOT_SANDBOX}  exact={true} component={PlotSandbox} />
                <PrivateRoute path={ROUTE.PROC_SANDBOX}  exact={true} component={ProcessingSandbox} />
                <PrivateRoute path={ROUTE.HDF_INSPECTOR} exact={true} component={HdfInspector} />

                {/* [BEDSIDE] Data Collection — admin only */}
                <AdminRoute path={ROUTE.PATIENTS} exact={true} component={Patients} />
                <AdminRoute path={ROUTE.DEVICES}  exact={true} component={Devices} />
                <AdminRoute path={ROUTE.MONITOR}  exact={true} component={Monitor} />

                {/* Admin only */}
                <AdminRoute path={ROUTE.CONTENT}       exact={true} component={Content} />
                <AdminRoute path={ROUTE.FILES}         exact={true} component={Files} />
                <AdminRoute path={ROUTE.CONFIGURATION} exact={true} component={Configuration} />

              </IonRouterOutlet>
            </IonSplitPane>
          </IonReactRouter>
        </IonApp>
      </AuthProvider>
    </ThemeProvider>
  );
};

export default App;
