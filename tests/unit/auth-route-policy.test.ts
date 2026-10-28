import { describe, expect, it } from 'vitest';
import { isAuthHttpPathAllowed } from '@/lib/auth/route-policy';

describe('isAuthHttpPathAllowed', () => {
  it.each([
    ['POST', '/sign-in/email'],
    ['POST', '/sign-out'],
    ['GET', '/get-session'],
    ['POST', '/lavador-pin/sign-in'],
    ['GET', '/organization/list'],
    ['POST', '/organization/set-active'],
  ])('libera %s %s', (method, path) => {
    expect(isAuthHttpPathAllowed(method, path)).toBe(true);
  });

  it.each([
    ['POST', '/sign-up/email'],
    ['GET', '/sign-up/email'],
    ['GET', '/sign-in/email'],
    ['PUT', '/sign-in/email'],
    ['POST', '/get-session'],
    ['POST', '/change-password'],
    ['POST', '/request-password-reset'],
    ['POST', '/reset-password'],
    ['POST', '/update-user'],
    ['POST', '/delete-user'],
    ['GET', '/list-sessions'],
    ['POST', '/organization/create'],
    ['POST', '/organization/update'],
    ['POST', '/organization/delete'],
    ['POST', '/organization/update-member-role'],
    ['POST', '/organization/remove-member'],
    ['POST', '/organization/invite-member'],
    ['POST', '/organization/accept-invitation'],
    ['GET', '/organization/get-full-organization'],
    ['GET', '/organization/list-members'],
    // variantes de grafia não podem escapar da lista
    ['POST', '/sign-in/email/'],
    ['POST', '/SIGN-IN/email'],
    ['POST', '//sign-in/email'],
    ['POST', '/sign-in/email?x=1'],
    ['POST', '/sign%2Din/email'],
    ['POST', ''],
    ['', '/sign-in/email'],
  ])('nega %s %s', (method, path) => {
    expect(isAuthHttpPathAllowed(method, path)).toBe(false);
  });

  it('método em minúsculas segue a mesma regra', () => {
    expect(isAuthHttpPathAllowed('post', '/sign-in/email')).toBe(true);
    expect(isAuthHttpPathAllowed('get', '/sign-up/email')).toBe(false);
  });
});
