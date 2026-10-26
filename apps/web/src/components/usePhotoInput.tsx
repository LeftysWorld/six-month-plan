import { useRef, type ReactElement } from 'react';
import type { Session } from '@six/core';

/**
 * A hidden camera/photo input shared by anything that takes a photo for a task: call `pick(session)`
 * to open it, render `input` once, and `onPicked` gets the session and the files.
 */
export function usePhotoInput(onPicked: (session: Session, files: File[]) => void | Promise<void>): { pick: (s: Session) => void; input: ReactElement } {
  const ref = useRef<HTMLInputElement>(null);
  const target = useRef<Session | null>(null);
  const pick = (s: Session) => {
    target.current = s;
    ref.current?.click();
  };
  const input = (
    <input
      ref={ref}
      type="file"
      accept="image/*"
      hidden
      onChange={(e) => {
        const s = target.current;
        const files = [...(e.target.files ?? [])];
        if (ref.current) ref.current.value = '';
        target.current = null;
        if (s && files.length) void onPicked(s, files);
      }}
    />
  );
  return { pick, input };
}
