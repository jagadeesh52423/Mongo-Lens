import { ReactElement } from 'react';

interface Props {
  pluginName: string;
  scopes: string[];
  onApprove: () => void;
  onDeny: () => void;
}

const SCOPE_LABELS: Record<string, string> = {
  'database:read':  'Read from your databases',
  'database:write': 'Write to your databases',
  'secrets:read':   'Read its own stored secrets',
  'secrets:write':  'Store secrets in its own namespace',
  'workspace:read': 'See your open scripts and saved scripts',
  'workspace:write':'Modify your open scripts and saved scripts',
};

interface ScopeDescription {
  label: string;
  arg?: string;
}

// implement this interface to add a new scope vocabulary entry
function describeScope(scope: string): ScopeDescription {
  if (scope.startsWith('network:fetch:')) {
    return { label: 'Make network requests to', arg: scope.slice('network:fetch:'.length) };
  }
  return { label: SCOPE_LABELS[scope] ?? scope };
}

export function PermissionConsentDialog(props: Props): ReactElement {
  return (
    <div role="dialog" aria-label="Plugin permissions">
      <h2>{props.pluginName} would like permission to:</h2>
      <ul>
        {props.scopes.map((s) => {
          const d = describeScope(s);
          return (
            <li key={s}>
              {d.label}{d.arg ? <> <code>{d.arg}</code></> : null}
            </li>
          );
        })}
      </ul>
      <div>
        <button onClick={props.onDeny}>Deny</button>
        <button onClick={props.onApprove}>Approve</button>
      </div>
    </div>
  );
}
