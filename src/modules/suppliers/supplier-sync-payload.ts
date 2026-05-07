import { isEmail, isUUID } from 'class-validator';
import type { CreateSupplierDto } from './dto/create-supplier.dto';
import type { UpdateSupplierDto } from './dto/update-supplier.dto';

const NAME_MAX = 200;
const PHONE_MAX = 80;
const EMAIL_MAX = 200;
const ADDRESS_MAX = 500;
const TAX_ID_MAX = 80;
const NOTES_MAX = 2000;

function fail(msg: string): { ok: false; details: string } {
  return { ok: false, details: msg };
}

/** `payload.supplier` for `opType: SUPPLIER_CREATE` (same field limits as `POST /suppliers`). */
export function parseSupplierCreatePayload(payload: Record<string, unknown>):
  | { ok: true; clientSupplierId: string; dto: CreateSupplierDto }
  | { ok: false; details: string } {
  const raw = payload.supplier;
  if (typeof raw !== 'object' || raw === null) {
    return fail('Invalid supplier payload: need payload.supplier object');
  }
  const s = raw as Record<string, unknown>;
  const clientRaw = s.clientSupplierId;
  if (typeof clientRaw !== 'string' || !isUUID(clientRaw, '4')) {
    return fail(
      'supplier.clientSupplierId is required and must be a UUID v4 (offline provisional id)',
    );
  }
  if (typeof s.name !== 'string') {
    return fail('supplier.name is required');
  }
  const name = s.name.trim();
  if (name.length < 1 || name.length > NAME_MAX) {
    return fail(`supplier.name length must be 1..${NAME_MAX}`);
  }

  const dto: CreateSupplierDto = { name };

  if (s.phone !== undefined) {
    if (typeof s.phone !== 'string') {
      return fail('supplier.phone must be a string');
    }
    const phone = s.phone.trim() || undefined;
    if (phone !== undefined && phone.length > PHONE_MAX) {
      return fail(`supplier.phone max length ${PHONE_MAX}`);
    }
    if (phone !== undefined) {
      dto.phone = phone;
    }
  }

  if (s.email !== undefined && s.email !== null) {
    if (typeof s.email !== 'string') {
      return fail('supplier.email must be a string');
    }
    const email = s.email.trim();
    if (email.length > 0) {
      if (email.length > EMAIL_MAX || !isEmail(email)) {
        return fail('supplier.email must be a valid email (max 200 chars)');
      }
      dto.email = email;
    }
  }

  if (s.address !== undefined) {
    if (typeof s.address !== 'string') {
      return fail('supplier.address must be a string');
    }
    const address = s.address.trim() || undefined;
    if (address !== undefined && address.length > ADDRESS_MAX) {
      return fail(`supplier.address max length ${ADDRESS_MAX}`);
    }
    if (address !== undefined) {
      dto.address = address;
    }
  }

  if (s.taxId !== undefined) {
    if (typeof s.taxId !== 'string') {
      return fail('supplier.taxId must be a string');
    }
    const taxId = s.taxId.trim() || undefined;
    if (taxId !== undefined && taxId.length > TAX_ID_MAX) {
      return fail(`supplier.taxId max length ${TAX_ID_MAX}`);
    }
    if (taxId !== undefined) {
      dto.taxId = taxId;
    }
  }

  if (s.notes !== undefined) {
    if (typeof s.notes !== 'string') {
      return fail('supplier.notes must be a string');
    }
    const notes = s.notes.trim() || undefined;
    if (notes !== undefined && notes.length > NOTES_MAX) {
      return fail(`supplier.notes max length ${NOTES_MAX}`);
    }
    if (notes !== undefined) {
      dto.notes = notes;
    }
  }

  return { ok: true, clientSupplierId: clientRaw, dto };
}

/** `payload.supplier` for `opType: SUPPLIER_UPDATE` (PATCH semantics, ≥1 field besides supplierId). */
export function parseSupplierUpdatePayload(payload: Record<string, unknown>):
  | { ok: true; supplierId: string; dto: UpdateSupplierDto }
  | { ok: false; details: string } {
  const raw = payload.supplier;
  if (typeof raw !== 'object' || raw === null) {
    return fail('Invalid supplier payload: need payload.supplier object');
  }
  const s = raw as Record<string, unknown>;
  if (typeof s.supplierId !== 'string' || !isUUID(s.supplierId, '4')) {
    return fail('supplier.supplierId is required and must be a UUID v4');
  }

  const dto: UpdateSupplierDto = {};
  let any = false;

  if (s.name !== undefined) {
    if (typeof s.name !== 'string') {
      return fail('supplier.name must be a string');
    }
    const name = s.name.trim();
    if (name.length < 1 || name.length > NAME_MAX) {
      return fail(`supplier.name length must be 1..${NAME_MAX}`);
    }
    dto.name = name;
    any = true;
  }

  if (s.phone !== undefined) {
    if (typeof s.phone !== 'string') {
      return fail('supplier.phone must be a string');
    }
    dto.phone = s.phone.trim() || undefined;
    if (dto.phone !== undefined && dto.phone.length > PHONE_MAX) {
      return fail(`supplier.phone max length ${PHONE_MAX}`);
    }
    any = true;
  }

  if (s.email !== undefined) {
    if (s.email === null) {
      dto.email = '';
      any = true;
    } else if (typeof s.email === 'string') {
      const email = s.email.trim();
      if (email.length > 0) {
        if (email.length > EMAIL_MAX || !isEmail(email)) {
          return fail('supplier.email must be a valid email (max 200 chars)');
        }
        dto.email = email;
      } else {
        dto.email = '';
      }
      any = true;
    } else {
      return fail('supplier.email must be a string or null');
    }
  }

  if (s.address !== undefined) {
    if (typeof s.address !== 'string') {
      return fail('supplier.address must be a string');
    }
    dto.address = s.address.trim() || undefined;
    if (dto.address !== undefined && dto.address.length > ADDRESS_MAX) {
      return fail(`supplier.address max length ${ADDRESS_MAX}`);
    }
    any = true;
  }

  if (s.taxId !== undefined) {
    if (typeof s.taxId !== 'string') {
      return fail('supplier.taxId must be a string');
    }
    dto.taxId = s.taxId.trim() || undefined;
    if (dto.taxId !== undefined && dto.taxId.length > TAX_ID_MAX) {
      return fail(`supplier.taxId max length ${TAX_ID_MAX}`);
    }
    any = true;
  }

  if (s.notes !== undefined) {
    if (typeof s.notes !== 'string') {
      return fail('supplier.notes must be a string');
    }
    dto.notes = s.notes.trim() || undefined;
    if (dto.notes !== undefined && dto.notes.length > NOTES_MAX) {
      return fail(`supplier.notes max length ${NOTES_MAX}`);
    }
    any = true;
  }

  if (s.active !== undefined) {
    if (typeof s.active !== 'boolean') {
      return fail('supplier.active must be a boolean');
    }
    dto.active = s.active;
    any = true;
  }

  if (!any) {
    return fail(
      'supplier update requires at least one field to change (name, phone, email, address, taxId, notes, active)',
    );
  }

  return { ok: true, supplierId: s.supplierId, dto };
}

/** `payload.supplier` for `opType: SUPPLIER_DEACTIVATE`. */
export function parseSupplierDeactivatePayload(payload: Record<string, unknown>):
  | { ok: true; supplierId: string }
  | { ok: false; details: string } {
  const raw = payload.supplier;
  if (typeof raw !== 'object' || raw === null) {
    return fail('Invalid supplier payload: need payload.supplier object');
  }
  const s = raw as Record<string, unknown>;
  if (typeof s.supplierId !== 'string' || !isUUID(s.supplierId, '4')) {
    return fail('supplier.supplierId is required and must be a UUID v4');
  }
  return { ok: true, supplierId: s.supplierId };
}
