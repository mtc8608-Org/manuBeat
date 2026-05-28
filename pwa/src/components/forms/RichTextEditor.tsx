// RichTextEditor — a lightweight WYSIWYG text editor.
// - Bold, italic, headings, bullet and numbered lists
// - Outputs clean HTML that gets stored in the database
// - Used inside forms wherever content needs formatting
import React, { useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';

export interface RichTextEditorProps {
  initialValue?: string;
  onChange: (html: string) => void;
  minHeight?: number;
}

const btnStyle = (active: boolean): React.CSSProperties => ({
  padding: '2px 8px',
  border: '1px solid var(--ion-border-color, #ccc)',
  borderRadius: 4,
  background: active ? 'var(--ion-color-primary)' : 'var(--ion-color-light, #f4f5f8)',
  color: active ? '#fff' : 'inherit',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: active ? 700 : 400,
});

const RichTextEditor: React.FC<RichTextEditorProps> = ({
  initialValue = '',
  onChange,
  minHeight = 180,
}) => {
  const editor = useEditor({
    extensions: [StarterKit],
    content: initialValue,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
  });

  // Sync when initialValue changes externally (e.g. edit modal re-opens).
  // Guard prevents loop: only update when editor HTML actually differs.
  useEffect(() => {
    if (!editor) return;
    if (editor.getHTML() !== initialValue) {
      editor.commands.setContent(initialValue || '');
    }
  }, [initialValue]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!editor) return null;

  return (
    <div style={{ border: '1px solid var(--ion-border-color, #ccc)', borderRadius: 6, overflow: 'hidden' }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 4, padding: '6px 10px',
        borderBottom: '1px solid var(--ion-border-color, #ccc)',
        background: 'var(--ion-color-light, #f4f5f8)',
      }}>
        <button type="button" style={btnStyle(editor.isActive('bold'))}
          onClick={() => editor.chain().focus().toggleBold().run()}>B</button>
        <button type="button" style={{ ...btnStyle(editor.isActive('italic')), fontStyle: 'italic' }}
          onClick={() => editor.chain().focus().toggleItalic().run()}>I</button>
        <button type="button" style={btnStyle(editor.isActive('heading', { level: 1 }))}
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>H1</button>
        <button type="button" style={btnStyle(editor.isActive('heading', { level: 2 }))}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>H2</button>
        <button type="button" style={btnStyle(editor.isActive('heading', { level: 3 }))}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>H3</button>
        <button type="button" style={btnStyle(editor.isActive('bulletList'))}
          onClick={() => editor.chain().focus().toggleBulletList().run()}>• List</button>
        <button type="button" style={btnStyle(editor.isActive('orderedList'))}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}>1. List</button>
        <button type="button" style={btnStyle(false)}
          onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}>Clear</button>
      </div>

      {/* Editor area */}
      <EditorContent
        editor={editor}
        style={{
          minHeight,
          maxHeight: 420,
          overflowY: 'auto',
          padding: '10px 14px',
          fontSize: 14,
          lineHeight: 1.6,
        }}
      />
    </div>
  );
};

export default RichTextEditor;
