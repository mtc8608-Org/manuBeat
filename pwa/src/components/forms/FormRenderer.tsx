// FormRenderer — turns a component tree from the database into a live form.
// - Renders inputs, checkboxes, selects, and rich-text fields from stored config
// - Works in two modes: app config (dot-path keys) and survey fill-in (UUID keys)
// - Supports read-only display and edit-in-place toggling
// - Calls back with the collected values on submit
import React, { useEffect } from 'react';
import {
  IonCard, IonCardContent, IonCardHeader, IonCardTitle,
  IonItem, IonLabel, IonInput, IonTextarea,
  IonButton, IonButtons, IonCheckbox,
  IonSelect, IonSelectOption,
} from '@ionic/react';
import { Controller, useForm } from 'react-hook-form';
import { ComponentResults } from '../../interfaces/types';
import { DEFAULT_COLOR } from '../../constants';
import RichTextEditor from './RichTextEditor';
import ImagePicker from './ImagePicker';
import CodeEditor from './CodeEditor';

// ╔══════════════════════════════════════════════════════════════════════════════╗
// ║  FormRenderer — unified renderer for both component trees and survey trees  ║
// ║                                                                              ║
// ║  mode="app"    → dot-path keys (options.label), isEditing mode available    ║
// ║                  used by: Configuration, Plotter, PlotBuilder, Assets       ║
// ║  mode="survey" → UUID keys (node.id), answers are cross-survey referenceable║
// ║                  used by: Surveys fill/edit                                 ║
// ║                                                                              ║
// ║  Both modes accept the same ComponentResults shape from GraphQL.            ║
// ║  DB tables differ (components vs survey_components) but the contract is     ║
// ║  identical — keep it that way.                                              ║
// ╚══════════════════════════════════════════════════════════════════════════════╝

export interface FormRendererProps {
  component: ComponentResults;
  mode?: 'app' | 'survey';
  defaultValues?: Record<string, any>;
  onSubmit?: (values: any) => void;
  submitLabel?: string;
  // app-mode editing controls (no-op in survey mode)
  isEditing?: boolean;
  onEdit?: (data: ComponentResults, context: string) => void;
  onLink?: (parentId: string) => void;
  onDelete?: (data: ComponentResults, parentId: string) => void;
  // runtime select options keyed by form field key
  injectedOptions?: Record<string, Array<{ value: string; label: string }>>;
}

const getValueByPath = (obj: any, path: string): any =>
  path.split('.').reduce((acc, key) => acc?.[key], obj);

const FormRenderer: React.FC<FormRendererProps> = ({
  component,
  mode = 'app',
  defaultValues = {},
  onSubmit,
  submitLabel = 'Save',
  isEditing = false,
  onEdit,
  onLink,
  onDelete,
  injectedOptions,
}) => {
  const { control, handleSubmit, reset, formState: { errors } } = useForm({ defaultValues });

  useEffect(() => {
    reset(defaultValues);
  }, [JSON.stringify(defaultValues)]); // eslint-disable-line react-hooks/exhaustive-deps

  // Compute the form field key and the label prefix to pass into child sections.
  // app mode:    dot-path  → "section.fieldName"  (maps to named config properties)
  // survey mode: UUID      → node.id              (enables cross-survey answer queries)
  const resolveKey = (node: ComponentResults, parentLabel: string): { key: string; childLabel: string } => {
    if (mode === 'survey') {
      return { key: node.id!, childLabel: '' };
    }
    const label = `${parentLabel}.${node.options?.label ?? ''}`;
    const key   = label.startsWith('.') ? label.slice(1) : label;
    return { key, childLabel: label };
  };

  const renderNode = (node: ComponentResults, parentLabel = '', parentId = ''): React.ReactNode => {
    const { key, childLabel } = resolveKey(node, parentLabel);

    switch (node.type) {
      case 'input':
      case 'text':     return renderText(node, key, parentId);
      case 'number':   return renderNumber(node, key, parentId);
      case 'color':    return renderColor(node, key, parentId);
      case 'date':     return renderDate(node, key, parentId);
      case 'textarea':   return renderTextarea(node, key, parentId);
      case 'code':       return renderCode(node, key, parentId);
      case 'lines':      return renderLines(node, key, parentId);
      case 'richtext':   return renderRichText(node, key, parentId);
      case 'filepicker': return renderFilepicker(node, key, parentId);
      case 'check':      return renderCheck(node, key, parentId);
      case 'select':     return renderSelect(node, key, parentId);
      case 'scale':      return renderScale(node, key, parentId);
      case 'form':
      case 'plotGrid':
      case 'plot':
      case 'survey':   return renderSection(node, childLabel, parentId);
      default:         return null;
    }
  };

  const renderText = (node: ComponentResults, key: string, parentId: string) => (
    <IonItem key={node.id ?? node.name}>
      {getValueByPath(errors, key) && (
        <IonLabel color="danger">{(getValueByPath(errors, key) as any)?.message}</IonLabel>
      )}
      <Controller
        name={key}
        control={control}
        render={({ field }) => (
          <IonInput
            label={node.data?.text}
            labelPlacement="stacked"
            placeholder={node.options?.placeholder ?? '...'}
            value={field.value ?? ''}
            onIonInput={e => field.onChange(e.detail.value)}
            onIonBlur={field.onBlur}
          />
        )}
      />
      {isEditing && editButtons(node, parentId)}
    </IonItem>
  );

  const renderNumber = (node: ComponentResults, key: string, parentId: string) => (
    <IonItem key={node.id ?? node.name}>
      <Controller
        name={key}
        control={control}
        render={({ field }) => (
          <IonInput
            label={node.data?.text}
            labelPlacement="stacked"
            type="number"
            step={node.options?.step ?? 'any'}
            min={node.options?.min}
            max={node.options?.max}
            placeholder={node.options?.placeholder ?? ''}
            value={field.value ?? ''}
            onIonInput={e => field.onChange(e.detail.value)}
            onIonBlur={field.onBlur}
          />
        )}
      />
      {isEditing && editButtons(node, parentId)}
    </IonItem>
  );

  const renderColor = (node: ComponentResults, key: string, parentId: string) => (
    <IonItem key={node.id ?? node.name}>
      <IonLabel>{node.data?.text}</IonLabel>
      <Controller
        name={key}
        control={control}
        render={({ field }) => (
          <input
            type="color"
            value={field.value || DEFAULT_COLOR}
            onChange={e => field.onChange(e.target.value)}
            style={{ width: 36, height: 28, cursor: 'pointer', border: 'none', padding: 0, background: 'transparent', borderRadius: 4 }}
          />
        )}
      />
      {isEditing && editButtons(node, parentId)}
    </IonItem>
  );

  const renderDate = (node: ComponentResults, key: string, parentId: string) => (
    <IonItem key={node.id ?? node.name}>
      <IonLabel>{node.data?.text}</IonLabel>
      <Controller
        name={key}
        control={control}
        render={({ field }) => (
          <input
            type="date"
            value={field.value ?? ''}
            onChange={e => field.onChange(e.target.value)}
            style={{
              width: '100%', marginTop: 8, padding: '6px 0',
              background: 'transparent', border: 'none',
              color: 'var(--ion-text-color)', fontSize: '1rem',
            }}
          />
        )}
      />
      {isEditing && editButtons(node, parentId)}
    </IonItem>
  );

  const renderTextarea = (node: ComponentResults, key: string, parentId: string) => (
    <IonItem key={node.id ?? node.name}>
      <Controller
        name={key}
        control={control}
        render={({ field }) => (
          <IonTextarea
            label={node.data?.text}
            labelPlacement="stacked"
            placeholder={node.options?.placeholder ?? ''}
            value={field.value ?? ''}
            onIonInput={e => field.onChange(e.detail.value)}
            onIonBlur={field.onBlur}
            autoGrow
          />
        )}
      />
      {isEditing && editButtons(node, parentId)}
    </IonItem>
  );

  // `code` — a collapsible, syntax-highlighted code editor (see CodeEditor).
  // Language comes from options.language (defaults to latex).
  const renderCode = (node: ComponentResults, key: string, parentId: string) => (
    <div key={node.id ?? node.name} style={{ paddingInline: 4 }}>
      <Controller
        name={key}
        control={control}
        render={({ field }) => (
          <CodeEditor
            label={node.data?.text}
            language={node.options?.language}
            value={field.value ?? ''}
            onChange={field.onChange}
          />
        )}
      />
      {isEditing && editButtons(node, parentId)}
    </div>
  );

  // `lines` — edit a string[] as a multi-line textarea (one item per line).
  // Stores an array so consumers keep their list shape.
  const renderLines = (node: ComponentResults, key: string, parentId: string) => (
    <IonItem key={node.id ?? node.name}>
      <Controller
        name={key}
        control={control}
        render={({ field }) => (
          <IonTextarea
            label={node.data?.text}
            labelPlacement="stacked"
            placeholder={node.options?.placeholder ?? 'One per line'}
            value={Array.isArray(field.value) ? field.value.join('\n') : (field.value ?? '')}
            onIonInput={e => field.onChange((e.detail.value ?? '').split('\n'))}
            onIonBlur={field.onBlur}
            autoGrow
          />
        )}
      />
      {isEditing && editButtons(node, parentId)}
    </IonItem>
  );

  const renderRichText = (node: ComponentResults, key: string, parentId: string) => (
    <div key={node.id ?? node.name} style={{ marginBottom: 8 }}>
      {node.data?.text && (
        <IonLabel style={{ display: 'block', padding: '8px 16px 4px', fontWeight: 500 }}>
          {node.data.text}
        </IonLabel>
      )}
      <div style={{ padding: '0 16px 8px' }}>
        <Controller
          name={key}
          control={control}
          render={({ field }) => (
            <RichTextEditor initialValue={field.value ?? ''} onChange={field.onChange} />
          )}
        />
      </div>
      {isEditing && editButtons(node, parentId)}
    </div>
  );

  const renderFilepicker = (node: ComponentResults, key: string, parentId: string) => (
    <div key={node.id ?? node.name} style={{ marginBottom: 8 }}>
      {node.data?.text && (
        <IonLabel style={{ display: 'block', padding: '8px 16px 4px', fontWeight: 500 }}>
          {node.data.text}
        </IonLabel>
      )}
      <div style={{ padding: '0 16px 8px' }}>
        <Controller
          name={key}
          control={control}
          render={({ field }) => (
            <ImagePicker value={field.value ?? ''} onChange={field.onChange} />
          )}
        />
      </div>
      {isEditing && editButtons(node, parentId)}
    </div>
  );

  const renderCheck = (node: ComponentResults, key: string, parentId: string) => (
    <IonItem key={node.id ?? node.name}>
      <Controller
        name={key}
        control={control}
        render={({ field }) => (
          <IonCheckbox
            labelPlacement="start"
            checked={!!field.value}
            onIonChange={e => field.onChange(e.detail.checked)}
          >
            {node.data?.text}
          </IonCheckbox>
        )}
      />
      {isEditing && editButtons(node, parentId)}
    </IonItem>
  );

  const renderSelect = (node: ComponentResults, key: string, parentId: string) => {
    const dynamic = injectedOptions?.[key];
    return (
      <IonItem key={node.id ?? node.name}>
        <Controller
          name={key}
          control={control}
          render={({ field }) => (
            <IonSelect
              label={node.data?.text}
              labelPlacement="stacked"
              placeholder="Select one"
              value={field.value}
              onIonChange={e => field.onChange(e.detail.value)}
            >
              {dynamic
                ? dynamic.map(opt => (
                    <IonSelectOption key={opt.value} value={opt.value}>{opt.label}</IonSelectOption>
                  ))
                : node.children?.map((child: ComponentResults) => (
                    <IonSelectOption key={child.id ?? child.name} value={child.data?.text}>
                      {child.data?.text}
                    </IonSelectOption>
                  ))
              }
            </IonSelect>
          )}
        />
        {isEditing && editButtons(node, parentId)}
      </IonItem>
    );
  };

  const renderScale = (node: ComponentResults, key: string, parentId: string) => {
    const min = node.options?.min ?? 1;
    const max = node.options?.max ?? 10;
    return (
      <IonItem key={node.id ?? node.name}>
        <div style={{ width: '100%' }}>
          <IonLabel>{node.data?.text}</IonLabel>
          <Controller
            name={key}
            control={control}
            render={({ field }) => (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                <span>{min}</span>
                <input
                  type="range" min={min} max={max}
                  value={field.value ?? min}
                  onChange={e => field.onChange(e.target.value)}
                  style={{ flex: 1 }}
                />
                <span>{max}</span>
                <span style={{ minWidth: 24, textAlign: 'center' }}>{field.value ?? min}</span>
              </div>
            )}
          />
        </div>
        {isEditing && editButtons(node, parentId)}
      </IonItem>
    );
  };

  const renderSection = (node: ComponentResults, childLabel: string, parentId: string) => (
    <IonCard key={node.id ?? node.name} style={{ marginTop: 12 }}>
      <IonCardHeader>
        <IonCardTitle>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{node.data?.text}</span>
            {isEditing && (
              <IonButtons>
                <IonButton color="success" onClick={() => onLink?.(node.id!)}>Add Link</IonButton>
                <IonButton color="warning" onClick={() => onEdit?.(node, 'editComponent')}>Edit</IonButton>
                <IonButton color="danger" onClick={() => onDelete?.(node, parentId)}>Remove</IonButton>
              </IonButtons>
            )}
          </div>
        </IonCardTitle>
      </IonCardHeader>
      <IonCardContent>
        {node.children?.map((child: ComponentResults) => renderNode(child, childLabel, node.id!))}
      </IonCardContent>
    </IonCard>
  );

  // Edit/Remove button pair shown on leaf nodes in isEditing mode
  const editButtons = (node: ComponentResults, parentId: string) => (
    <IonButtons>
      <IonButton color="warning" onClick={() => onEdit?.(node, 'editComponent')}>Edit</IonButton>
      <IonButton color="danger"  onClick={() => onDelete?.(node, parentId)}>Remove</IonButton>
    </IonButtons>
  );

  return (
    <IonCard>
      <form onSubmit={handleSubmit(data => onSubmit?.(data))}>
        <IonCardHeader>
          <IonItem lines="none">
            <IonCardTitle slot="start">{component.data?.text}</IonCardTitle>
            {isEditing && (
              <IonButtons slot="end">
                <IonButton color="success" onClick={() => onEdit?.(component, 'editComponent')}>Edit</IonButton>
                <IonButton color="success" onClick={() => onLink?.(component.id!)}>Link</IonButton>
              </IonButtons>
            )}
          </IonItem>
        </IonCardHeader>
        <IonCardContent>
          {component.children?.map((child: ComponentResults) =>
            renderNode(child, '', component.id!)
          )}
          {onSubmit && (
            <IonButtons style={{ marginTop: 16 }}>
              <IonButton expand="block" type="submit">{submitLabel}</IonButton>
            </IonButtons>
          )}
        </IonCardContent>
      </form>
    </IonCard>
  );
};

export default FormRenderer;
