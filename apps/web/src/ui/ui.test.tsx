import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactNode, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../lib/i18n/index.ts';

import { QrSvg } from './QrBlock.tsx';
import {
  Banner,
  Button,
  CodeInput,
  DataTable,
  Dialog,
  downloadText,
  EmptyState,
  ErrorState,
  Field,
  HelpLink,
  LanguageSwitch,
  Money,
  ResultCard,
  Select,
  Skeleton,
  StatusPill,
  toCsv,
} from './index.ts';

const wrap = (ui: ReactNode) => render(<I18nProvider lang="en">{ui}</I18nProvider>);

describe('Button', () => {
  it('is never disabled without a visible reason', () => {
    wrap(<Button disabledReason="No internet">{'Confirm'}</Button>);
    const b = screen.getByRole('button', { name: 'Confirm' });
    expect(b).toBeDisabled();
    expect(b).toHaveAccessibleDescription('No internet');
  });
  it('loading state is busy and disabled; variants render', () => {
    wrap(
      <>
        <Button loading>{'A'}</Button>
        <Button variant="danger" size="lg">
          {'B'}
        </Button>
        <Button variant="ghost">{'C'}</Button>
        <Button variant="secondary">{'D'}</Button>
      </>,
    );
    expect(screen.getByRole('button', { name: 'A' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: 'B' })).toBeEnabled();
  });
});

describe('ResultCard', () => {
  it('do-not-pay results are alerts; others are polite status', () => {
    wrap(<ResultCard variant="invalid" title="Do NOT pay" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Do NOT pay');
    wrap(
      <ResultCard variant="valid" title="Valid">
        {'details'}
      </ResultCard>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Valid');
    wrap(<ResultCard variant="checking" title="Checking" />);
    wrap(<ResultCard variant="warning" title="Warn" />);
    expect(screen.getAllByRole('status')).toHaveLength(3);
  });
});

describe('small components', () => {
  it('render text, icons and states', () => {
    wrap(
      <>
        <Banner tone="warning" action={<span>{'act'}</span>}>
          {'offline'}
        </Banner>
        <Banner tone="info">{'info'}</Banner>
        <StatusPill tone="good">{'ok'}</StatusPill>
        <Money paise={10_000_000} />
        <Skeleton lines={2} />
        <EmptyState>{'nothing'}</EmptyState>
        <ErrorState />
        <HelpLink phone="+91 20 0000 0000" />
        <HelpLink phone={null} />
      </>,
    );
    expect(screen.getByText('₹1,00,000')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Call 24M: +91 20 0000 0000' })).toHaveAttribute(
      'href',
      'tel:+912000000000',
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
  });

  it('ErrorState retry', async () => {
    const onRetry = vi.fn();
    wrap(<ErrorState message="boom" onRetry={onRetry} />);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('Field and Select are labelled and show errors', async () => {
    const onChange = vi.fn();
    wrap(
      <>
        <Field label="Mobile" error="Bad number" defaultValue="" />
        <Field label="Name" hint="Your name" />
        <Select
          label="Reason"
          value="a"
          onChange={onChange}
          options={[
            { value: 'a', label: 'A' },
            { value: 'b', label: 'B' },
          ]}
        />
      </>,
    );
    expect(screen.getByLabelText('Mobile')).toHaveAccessibleDescription('Bad number');
    expect(screen.getByLabelText('Mobile')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'false');
    await userEvent.selectOptions(screen.getByLabelText('Reason'), 'b');
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('LanguageSwitch changes the language', async () => {
    wrap(<LanguageSwitch />);
    await userEvent.selectOptions(screen.getByLabelText('Language'), 'hi');
    expect(await screen.findByLabelText('भाषा')).toBeInTheDocument();
  });

  it('QrSvg renders an accessible image of dark modules', () => {
    const { container } = wrap(
      <QrSvg
        value="https://wa.me/919000000000?text=24M%20PAID%20K7Q2M9"
        label="QR: 24M PAID K7Q2M9"
      />,
    );
    expect(screen.getByRole('img', { name: 'QR: 24M PAID K7Q2M9' })).toBeInTheDocument();
    expect(container.querySelectorAll('rect').length).toBeGreaterThan(100);
  });
});

describe('CodeInput (EC-001..EC-006)', () => {
  it('groups, validates the check character and submits a valid code', async () => {
    const onValid = vi.fn();
    wrap(<CodeInput onValid={onValid} />);
    const input = screen.getByLabelText('Coupon code (13 characters)');
    await userEvent.type(input, '0000000000001');
    expect(screen.getByText('Check the last letter of the code.')).toBeInTheDocument();
    expect(input).toHaveAttribute('aria-invalid', 'true');
    await userEvent.clear(input);
    await userEvent.type(input, '000000000000');
    expect(screen.getByText('1 more characters')).toBeInTheDocument();
    await userEvent.type(input, '0');
    expect(input).toHaveValue('0000-0000-0000-0');
    await userEvent.click(screen.getByRole('button', { name: 'Check coupon' }));
    expect(onValid).toHaveBeenCalledWith('0000000000000');
  });

  it('rejects U and empty submits', async () => {
    const onValid = vi.fn();
    wrap(<CodeInput onValid={onValid} />);
    await userEvent.click(screen.getByRole('button', { name: 'Check coupon' }));
    expect(screen.getByText('13 more characters')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Coupon code (13 characters)'), 'U');
    expect(screen.getByText('Use only letters and numbers (no U).')).toBeInTheDocument();
    expect(onValid).not.toHaveBeenCalled();
  });
});

describe('Dialog (2.1.2, 2.4.3)', () => {
  function Harness(): ReactNode {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button
          type="button"
          onClick={() => {
            setOpen(true);
          }}
        >
          {'open'}
        </button>
        <Dialog
          open={open}
          title="Confirm"
          onClose={() => {
            setOpen(false);
          }}
        >
          <button type="button">{'first'}</button>
          <button type="button">{'last'}</button>
        </Dialog>
      </>
    );
  }

  it('focuses inside, traps Tab, closes on Esc and returns focus', async () => {
    wrap(<Harness />);
    const opener = screen.getByRole('button', { name: 'open' });
    await userEvent.click(opener);
    expect(screen.getByRole('dialog', { name: 'Confirm' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'first' })).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(screen.getByRole('button', { name: 'last' })).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole('button', { name: 'first' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('a dialog with nothing focusable still handles Tab', () => {
    wrap(
      <Dialog open title="Empty" onClose={() => undefined}>
        {'text'}
      </Dialog>,
    );
    fireEvent.keyDown(document, { key: 'Tab' });
    fireEvent.keyDown(document, { key: 'x' });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('DataTable', () => {
  const rows = [
    { id: 1, name: 'b', v: 2, obj: { x: 1 } },
    { id: 2, name: 'a', v: 1, obj: null },
  ];
  const columns = [
    { key: 'name', label: 'Name' },
    { key: 'v', label: 'Value', value: (r: (typeof rows)[number]) => r.v },
    { key: 'obj', label: 'Obj' },
    { key: 'x', label: 'Render', render: () => <em>{'r'}</em> },
  ];

  it('sorts, navigates with J/K, forwards other keys and exports CSV', async () => {
    const onRowKey = vi.fn();
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    wrap(
      <DataTable
        columns={columns}
        rows={rows}
        caption="T"
        rowKey={(r) => r.id}
        csvName="t"
        onRowKey={onRowKey}
      />,
    );
    const header = screen.getByRole('button', { name: 'Name' });
    await userEvent.click(header);
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('a');
    expect(screen.getByRole('columnheader', { name: 'Name' })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    await userEvent.click(header);
    expect(screen.getAllByRole('row')[1]).toHaveTextContent('b');
    await userEvent.click(screen.getByRole('button', { name: 'Value' }));
    const bodyRows = screen.getAllByRole('row').slice(1);
    act(() => {
      bodyRows[0]?.focus();
    });
    await userEvent.keyboard('j');
    expect(bodyRows[1]).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    expect(bodyRows[0]).toHaveFocus();
    await userEvent.keyboard('k{ArrowDown}a');
    expect(onRowKey).toHaveBeenCalledWith('a', expect.anything());
    await userEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
    expect(click).toHaveBeenCalled();
  });

  it('empty state and sorting by an unknown column', () => {
    wrap(<DataTable columns={columns} rows={[]} caption="T" rowKey={() => 1} />);
    expect(screen.getByText('Nothing here yet')).toBeInTheDocument();
  });

  it('toCsv escapes and neutralises formulas', () => {
    expect(toCsv([{ key: 'a', label: 'A' }], [{ a: '=1+1' }, { a: 'x,"y"' }, { a: null }])).toBe(
      'A\r\n\'=1+1\r\n"x,""y"""\r\n',
    );
    URL.createObjectURL = vi.fn(() => 'blob:y');
    const revoke = vi.fn();
    URL.revokeObjectURL = revoke;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    downloadText('a.txt', 'x', 'text/plain');
    expect(revoke).toHaveBeenCalledWith('blob:y');
  });
});
