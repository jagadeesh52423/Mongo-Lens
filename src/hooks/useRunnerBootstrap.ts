import { useEffect } from 'react';
import { checkNodeRunner, installNodeRunner } from '../ipc';
import { useLogger } from '../services/logger';

/**
 * On app startup, ensure the Node.js runner is installed. The check runs on
 * mount; if the runner is not ready, installation is kicked off in the
 * background. Failures are logged but do not block render — the user will see
 * a runner error later if they try to execute a script.
 */
export function useRunnerBootstrap(): void {
  const log = useLogger('hooks.useRunnerBootstrap');
  useEffect(() => {
    checkNodeRunner()
      .then((status) => {
        log.info('runner check', { status });
        if (!status.ready) {
          log.info('runner not ready; installing');
          installNodeRunner()
            .then(() => log.info('runner install complete'))
            .catch((e) => log.error('runner install failed', { err: String(e) }));
        }
      })
      .catch((e) => log.error('runner check failed', { err: String(e) }));
  }, [log]);
}
