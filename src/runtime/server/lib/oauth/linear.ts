import type { H3Event } from 'h3'
import { eventHandler, createError, getQuery, getRequestURL, sendRedirect } from 'h3'
import { withQuery } from 'ufo'
import { defu } from 'defu'
import { useRuntimeConfig } from '#imports'
import type { OAuthConfig } from '#auth-utils'

export interface OAuthLinearConfig {
  /**
   * Linear OAuth Client ID
   * @default process.env.NUXT_OAUTH_LINEAR_CLIENT_ID
   */
  clientId?: string
  /**
   * Linear OAuth Client Secret
   * @default process.env.NUXT_OAUTH_LINEAR_CLIENT_SECRET
   */
  clientSecret?: string
  /**
   * Require email from user, adds the ['user:email'] scope if not present
   * @default false
   */
  emailRequired?: boolean

  /**
   * Linear OAuth Authorization URL
   * @default 'https://linear.app/oauth/authorize'
   */
  authorizationURL?: string

  /**
   * Linear OAuth Token URL
   * @default 'https://api.linear.app/oauth/token'
   */
  tokenURL?: string
}

export function linearEventHandler({ config, onSuccess, onError }: OAuthConfig<OAuthLinearConfig>) {
  return eventHandler(async (event: H3Event) => {
    config = defu(config, useRuntimeConfig(event).oauth?.linear, {
      authorizationURL: 'https://linear.app/oauth/authorize',
      tokenURL: 'https://api.linear.app/oauth/token',
    }) as OAuthLinearConfig
    const query = getQuery(event)

    if (query.error) {
      const error = createError({
        statusCode: 401,
        message: `Linear login failed: ${query.error || 'Unknown error'}`,
        data: query,
      })
      if (!onError) throw error
      return onError(event, error)
    }

    if (!config.clientId || !config.clientSecret) {
      const error = createError({
        statusCode: 500,
        message: 'Missing NUXT_OAUTH_LINEAR_CLIENT_ID or NUXT_OAUTH_LINEAR_CLIENT_SECRET env variables.',
      })
      if (!onError) throw error
      return onError(event, error)
    }

    if (!query.code) {
      // Redirect to Linear Oauth page
      const redirectUrl = getRequestURL(event).href
      return sendRedirect(
        event,
        withQuery(config.authorizationURL as string, {
          client_id: config.clientId,
          redirect_uri: redirectUrl,
          response_type: 'code',
          prompt: 'consent',
        }),
      )
    }

    // TODO: improve typing
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tokens: any = await $fetch(
      config.tokenURL as string,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: {
          code: query.code,
          redirect_uri: '/',
          client_id: config.clientId,
          client_secret: config.clientSecret,
          grant_type: 'authorization_code',
        },
      },
    )
    if (tokens.error) {
      const error = createError({
        statusCode: 401,
        message: `Linear login failed: ${tokens.error || 'Unknown error'}`,
        data: tokens,
      })
      if (!onError) throw error
      return onError(event, error)
    }

    const accessToken = tokens.access_token
    // TODO: improve typing
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const linearUser: any = await $fetch('https://api.linear.app/graphql', {
      headers: {
        'User-Agent': `Linear-OAuth-${config.clientId}`,
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: {
        query: 'query Me {\n  viewer {\n    id\n    name\n    email\n  }\n}',
      },
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user: any = {
      id: linearUser.data.data.viewer.id,
      name: linearUser.data.data.viewer.name,
      email: linearUser.data.data.viewer.email,
    }

    return onSuccess(event, {
      user,
      tokens,
    })
  })
}
