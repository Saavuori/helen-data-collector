import React from 'react';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { Button, Spinner, makeStyles, mergeClasses } from '@fluentui/react-components';
import {
  DocumentBulletList24Filled,
  Info20Regular,
  ErrorCircle24Regular,
} from '@fluentui/react-icons';

import { usePalette } from '../theme';
import { errorText, localized } from '../api';
import { Card, EmptyState, Row, RowList } from './ui';
import type { Product } from '../types';

const fmtDate = (value: string | null | undefined) =>
  value
    ? new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : '—';

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
      gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
      gap: '16px',
    },
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
  },
  productId: {
    display: 'block',
    marginTop: '2px',
    fontSize: '12px',
    color: 'var(--text-faint)',
  },
  tagRail: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
    padding: '0 16px 12px',
  },
  tag: {
    display: 'inline-flex',
    alignItems: 'center',
    height: '24px',
    padding: '0 10px',
    borderRadius: '999px',
    background: 'var(--energy-soft)',
    color: 'var(--energy)',
    fontSize: '11px',
    fontWeight: 650,
    letterSpacing: '0.01em',
  },
  description: {
    display: 'flex',
    gap: '8px',
    margin: '0 16px 14px',
    padding: '10px 12px',
    borderRadius: '14px',
    background: 'var(--surface-alt)',
    border: '1px solid var(--border)',
    fontSize: '13px',
    lineHeight: 1.55,
    color: 'var(--text-muted)',
  },
  groupLabel: {
    display: 'block',
    padding: '0 16px 6px',
    fontSize: '11px',
    fontWeight: 700,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: 'var(--text-faint)',
  },
  groupLabelSpaced: {
    paddingTop: '16px',
  },
  postfix: {
    marginLeft: '4px',
    fontWeight: 500,
    color: 'var(--text-faint)',
  },
  loading: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '64px 0',
  },
});

const PlanView: React.FC = () => {
  const styles = useStyles();
  const palette = usePalette();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['products'],
    queryFn: async () => {
      const res = await axios.get<Product[]>('products');
      return res.data;
    },
    staleTime: 1000 * 60 * 30,
  });

  return (
    <div className={mergeClasses(styles.view, 'animate-fade-in')}>
      <div>
        <h1 className={styles.title}>Plan</h1>
        <span className={styles.subtitle}>Products and pricing on your active contract</span>
      </div>

      {isLoading ? (
        <div className={styles.loading}>
          <Spinner size="small" label="Loading plan details…" />
        </div>
      ) : isError ? (
        <Card>
          <EmptyState
            icon={<ErrorCircle24Regular />}
            title="Could not load your plan"
            body={errorText(error, 'The backend did not answer.')}
            action={<Button appearance="secondary" onClick={() => refetch()}>Retry</Button>}
          />
        </Card>
      ) : !data?.length ? (
        <Card>
          <EmptyState
            icon={<DocumentBulletList24Filled />}
            title="No products"
            body="Helen lists no priced products for the selected contract."
          />
        </Card>
      ) : (
        <div className={styles.list}>
          {data.map(product => {
            const name = localized(product.localized_name) || product.name || 'Product';
            const description = localized(product.product_description?.text);
            const subtypes = product.product_subtypes ?? [];
            const components = product.components ?? [];

            return (
              <Card key={product.id} padded={false}>
                <div className={styles.head}>
                  <span className={styles.iconTile}>
                    <DocumentBulletList24Filled />
                  </span>
                  <div className={styles.headText}>
                    <span className={styles.name}>{name}</span>
                    <span className={styles.productId}>ID {product.id}</span>
                  </div>
                </div>

                {subtypes.length > 0 && (
                  <div className={styles.tagRail}>
                    {subtypes.map(subtype => (
                      <span key={subtype} className={styles.tag}>{subtype}</span>
                    ))}
                  </div>
                )}

                {description && (
                  <div className={styles.description}>
                    <Info20Regular fontSize={16} style={{ flexShrink: 0, marginTop: '1px' }} />
                    {description}
                  </div>
                )}

                {components.length > 0 && (
                  <>
                    <span className={styles.groupLabel}>Pricing components</span>
                    <RowList>
                      {components.map(component => {
                        const unit =
                          localized(component.localized_price_unit) || component.price_unit || '';
                        const postfix = localized(component.price_postfix);
                        return (
                          <Row
                            key={component.id}
                            label={localized(component.localized_name) || component.name || 'Component'}
                            // A base price is a fixed monthly fee; everything
                            // else is charged per kWh consumed.
                            valueColor={component.is_base_price ? palette.spot : palette.energy}
                            mono
                            value={
                              <>
                                {component.price} {unit}
                                {postfix && <span className={styles.postfix}>{postfix}</span>}
                              </>
                            }
                          />
                        );
                      })}
                    </RowList>
                  </>
                )}

                <span className={mergeClasses(styles.groupLabel, styles.groupLabelSpaced)}>
                  Contract
                </span>
                <RowList>
                  {product.product_type && <Row label="Type" value={product.product_type} />}
                  <Row label="Active since" value={fmtDate(product.start_date)} mono />
                </RowList>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default PlanView;
