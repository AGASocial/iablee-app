/* eslint-disable react-hooks/rules-of-hooks */
import { test as base, expect } from "@playwright/test";
import { cleanupUserData, createThrowawayUser, type E2EUser } from "./supabase";

type E2EFixtures = {
  user: E2EUser;
  createUser: () => Promise<E2EUser>;
};

export const test = base.extend<E2EFixtures>({
  createUser: async ({}, use) => {
    const createdUserIds: string[] = [];

    const createUser = async () => {
      const user = await createThrowawayUser();
      createdUserIds.push(user.id);
      return user;
    };

    await use(createUser);

    for (const userId of createdUserIds.reverse()) {
      await cleanupUserData(userId);
    }
  },

  user: async ({ createUser }, use) => {
    const user = await createUser();
    await use(user);
  },
});

export { expect };
