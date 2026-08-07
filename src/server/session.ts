import { ObjectId } from 'mongodb';
import { auth } from '@/auth';
import { UnauthenticatedError } from '@/domain/errors';

export async function requireUserId(): Promise<ObjectId> {
  const session = await auth();
  const id = session?.user?.id;
  if (!id) throw new UnauthenticatedError();
  return new ObjectId(id);
}
