import { registerUser } from '@/server/users';
import { ensureIndexes } from '@/server/db';
import { fail, ok } from '../../_lib/respond';

export async function POST(request: Request) {
  try {
    await ensureIndexes();
    const body = await request.json();
    const id = await registerUser(String(body?.email ?? ''), String(body?.password ?? ''));
    return ok({ id: id.toHexString() }, 201);
  } catch (error) {
    return fail(error);
  }
}
