import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { Button, Spinner, makeStyles, mergeClasses, shorthands } from '@fluentui/react-components';
import {
  Home24Filled,
  Location20Regular,
  CheckmarkCircle20Filled,
  ErrorCircle24Regular,
} from '@fluentui/react-icons';

import { usePalette } from '../theme';
import { Card, EmptyState, Row, RowList } from './ui';
import type { ContractsResponse } from '../types';

/** Helen dates arrive as `2023-01-01T00:00:00` with no zone; only the day
 *  part is meaningful for a contract. */
const contractDate = (value: string | null | undefined) => {
  if (!value) return null;
  const day = value.split('T')[0];
  return day || null;
};

/** Contracts that never end carry the sentinel year 9999. */
const isOpenEnded = (value: string | null | undefined) =>
  !value || value.startsWith('9999');

const useStyles = makeStyles({
  view: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  title: {
    fontSize: '28px',
    fontWeight: 700,
    letterSpacing: '-0.03em',
    lineHeight: 1.1,
    padding: '0 4px',
  },
  subtitle: {
    display: 'block',
    marginTop: '4px',
    fontSize: '14px',
    color: 'var(--text-muted)',
  },
  list: {
    display: 'grid',
    gridTemplateColumns: '1fr',
    gap: '12px',
    '@media (min-width: 768px)': {
      gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
      gap: '16px',
    },
  },
  cardActive: {
    ...shorthands.borderColor('var(--energy)'),
  },
  head: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '16px 16px 12px',
  },
  iconTile: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '42px',
    height: '42px',
    borderRadius: '14px',
    background: 'var(--energy-soft)',
    color: 'var(--energy)',
    flexShrink: 0,
  },
  headText: {
    minWidth: 0,
    flex: 1,
  },
  name: {
    display: 'block',
    fontSize: '16px',
    fontWeight: 650,
    letterSpacing: '-0.02em',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  address: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    marginTop: '2px',
    fontSize: '13px',
    color: 'var(--text-muted)',
  },
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '5px',
    height: '26px',
    padding: '0 10px',
    borderRadius: '999px',
    background: 'var(--energy-soft)',
    color: 'var(--energy)',
    fontSize: '12px',
    fontWeight: 650,
    flexShrink: 0,
  },
  footer: {
    padding: '12px 16px 16px',
  },
  selectButton: {
    width: '100%',
    height: '44px',
    borderRadius: '12px',
    justifyContent: 'center',
  },
  loading: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '64px 0',
  },
});

const SitesView: React.FC = () => {
  const styles = useStyles();
  const palette = usePalette();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['contracts'],
    queryFn: async () => {
      const res = await axios.get<ContractsResponse>('contracts');
      return res.data;
    },
    staleTime: 1000 * 60 * 30,
  });

  const selectMutation = useMutation({
    mutationFn: async (gsrn: string) => {
      await axios.post('contracts/select', { gsrn });
      return gsrn;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
      queryClient.invalidateQueries({ queryKey: ['consumption'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });

  return (
    <div className={mergeClasses(styles.view, 'animate-fade-in')}>
      <div>
        <h1 className={styles.title}>Sites</h1>
        <span className={styles.subtitle}>Delivery sites linked to your Helen account</span>
      </div>

      {isLoading ? (
        <div className={styles.loading}>
          <Spinner size="small" label="Loading sites…" />
        </div>
      ) : isError ? (
        <Card>
          <EmptyState
            icon={<ErrorCircle24Regular />}
            title="Could not load sites"
            body="The backend did not answer. Check that it is running and try again."
            action={<Button appearance="secondary" onClick={() => refetch()}>Retry</Button>}
          />
        </Card>
      ) : !data?.contracts?.length ? (
        <Card>
          <EmptyState
            icon={<Home24Filled />}
            title="No active contracts"
            body="Your Helen account has no active electricity contracts attached to it."
          />
        </Card>
      ) : (
        <div className={styles.list}>
          {data.contracts.map(contract => {
            const isSelected = contract.gsrn === data.selected_gsrn;
            const address = contract.delivery_site?.address;
            const city = [address?.postal_code, address?.city].filter(Boolean).join(' ');
            const started = contractDate(contract.start_date);
            const ends = isOpenEnded(contract.end_date) ? null : contractDate(contract.end_date);
            const isPending = selectMutation.isPending && selectMutation.variables === contract.gsrn;

            return (
              <Card key={contract.gsrn} padded={false} className={isSelected ? styles.cardActive : undefined}>
                <div className={styles.head}>
                  <span className={styles.iconTile}>
                    <Home24Filled />
                  </span>
                  <div className={styles.headText}>
                    <span className={styles.name}>{address?.street_address || 'Delivery site'}</span>
                    {city && (
                      <span className={styles.address}>
                        <Location20Regular fontSize={15} />
                        {city}
                      </span>
                    )}
                  </div>
                  {isSelected && (
                    <span className={styles.badge}>
                      <CheckmarkCircle20Filled fontSize={14} />
                      Active
                    </span>
                  )}
                </div>

                <RowList>
                  <Row label="GSRN" value={contract.gsrn} mono />
                  {contract.domain && <Row label="Contract" value={contract.domain} />}
                  {started && <Row label="Started" value={started} mono />}
                  {ends && <Row label="Ends" value={ends} mono />}
                </RowList>

                {!isSelected && (
                  <div className={styles.footer}>
                    <Button
                      appearance="secondary"
                      className={styles.selectButton}
                      disabled={isPending}
                      icon={isPending ? <Spinner size="tiny" /> : undefined}
                      onClick={() => selectMutation.mutate(contract.gsrn)}
                    >
                      Show this site
                    </Button>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {selectMutation.isError && (
        <Card>
          <span style={{ color: palette.negative, fontSize: '13px' }}>
            Could not switch site — please try again.
          </span>
        </Card>
      )}
    </div>
  );
};

export default SitesView;
