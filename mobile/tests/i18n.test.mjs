import assert from 'node:assert/strict'
import test from 'node:test'
import { formatDateTime, formatNumber } from '../src/i18n/format.ts'
import { translate, translateError, translationKeys, translateRole } from '../src/i18n/translations.ts'

test('English and Swahili dictionaries cover every typed translation key', () => {
  for (const key of translationKeys) {
    assert.notEqual(translate('en', key).trim(), '', `English translation missing for ${key}`)
    assert.notEqual(translate('sw', key).trim(), '', `Swahili translation missing for ${key}`)
  }
})

test('translated messages interpolate dynamic values and localize known errors', () => {
  assert.equal(translate('sw', 'pos.stockShort', { name: 'Chai', count: 2 }), 'Chai: zipo 2 tu stoo.')
  assert.equal(translateError('sw', 'Username or password is incorrect.'), 'Jina la mtumiaji au nenosiri si sahihi.')
  assert.equal(translateError('sw', 'Network request failed'), 'Imeshindwa kuunganisha na ShopFlow. Kagua intaneti na anwani ya seva.')
})

test('date and number formatting follow the selected Tanzania locale', () => {
  assert.equal(formatNumber(1234567, 'en'), '1,234,567')
  assert.equal(formatNumber(1234567, 'sw'), '1,234,567')
  assert.match(formatDateTime('2026-01-02T03:04:00.000Z', 'en'), /2026/)
  assert.match(formatDateTime('2026-01-02T03:04:00.000Z', 'sw'), /2026/)
  assert.equal(translateRole('sw', 'store_manager'), 'Meneja wa duka')
  assert.equal(translateRole('en', 'future_role'), 'future role')
})
