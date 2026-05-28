// ComponentForm — the create / edit modal for a single component node.
// - Picks the right editor form based on the node's type
// - Pre-fills fields when editing an existing node
// - Saves changes back to the database on submit
import React, { useEffect, useState } from 'react';
import { IonContent } from '@ionic/react';
import ApiService from '../../services/Api';
import FormRenderer from './FormRenderer';
import { Component, ComponentModal, ComponentResults } from '../../interfaces/types';
import { EDITOR_ID, TYPE } from '../../constants';

const editorIds: Record<string, string> = {
  [TYPE.FORM]:      EDITOR_ID.DEFAULT,
  [TYPE.INPUT]:     EDITOR_ID.DEFAULT,
  [TYPE.CHECK]:     EDITOR_ID.DEFAULT,
  [TYPE.SELECT]:    EDITOR_ID.DEFAULT,
  [TYPE.PLOT]:      EDITOR_ID.PLOT,
  [TYPE.PLOT_GRID]: EDITOR_ID.DEFAULT,
};

export const ShowComponentModal: React.FC<ComponentModal> = ({ component, context, onDismiss }) => {
  const [editorForm, setEditorForm] = useState<ComponentResults | null>(null);

  useEffect(() => {
    const editorId = editorIds[component.type] ?? editorIds.form;
    ApiService.getComponentByName(editorId).then(form => { if (form) setEditorForm(form); });
  }, [component.type]);

  const defaultValues = {
    name:    component.name,
    type:    component.type,
    data:    component.data,
    options: component.options,
  };

  const handleSubmit = async (values: any) => {
    try {
      let saved: Component;
      if (context === 'editComponent' && component.id) {
        const result: any = await ApiService.updateComponent(
          component.id, values.name, values.type, values.data, values.options
        );
        saved = result?.data?.updateComponent ?? component;
      } else {
        const result: any = await ApiService.createComponent(
          values.name, values.type, values.data, values.options, []
        );
        saved = result?.data?.createComponent ?? component;
      }
      onDismiss?.(saved);
    } catch (e) {
      console.error('Component save failed', e);
    }
  };

  return (
    <IonContent className="ion-padding">
      {editorForm && (
        <FormRenderer
          key={component.id ?? 'new'}
          component={editorForm}
          defaultValues={defaultValues}
          onSubmit={handleSubmit}
          submitLabel={context === 'editComponent' ? 'Save Changes' : 'Create Component'}
        />
      )}
    </IonContent>
  );
};

const ComponentService = { ShowComponentModal };
export default ComponentService;
