// ListModal — a popup browser for picking an existing component.
// - Filter by component type to narrow the list
// - Scroll and click to select; dismisses itself with the chosen item
// - Used when linking an existing node into a tree
import React, { useState } from 'react';
import { IonContent } from '@ionic/react';
import { ComponentResults } from '../../interfaces/types';
import ApiService from '../../services/Api';
import ResourcePanel from '../shell/ResourcePanel';
import { APP_COMPONENT_TYPES } from '../../constants';

export interface ListPopup {
  onDismiss: (data: ComponentResults) => void;
}

const ListModal: React.FC<ListPopup> = ({ onDismiss }) => {
  const [listType, setListType] = useState('');

  return (
    <IonContent>
      <ResourcePanel
        fetcher={() => listType
          ? ApiService.getList(listType).then(
              list => list.filter((item): item is ComponentResults & { id: string } => !!item.id)
            )
          : Promise.resolve([])}
        refreshToken={listType}
        title="Select Component"
        getLabel={item => item.name}
        onSelect={onDismiss}
        emptyMessage="Select a type to load components"
        filter={{
          types: APP_COMPONENT_TYPES,
          typeValue: listType,
          onTypeChange: setListType,
        }}
      />
    </IonContent>
  );
};

export default ListModal;
