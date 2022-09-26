// localhost test command
//sbv2 anchor test --keypair ~/.config/solana/id.json -s

import * as anchor from "@project-serum/anchor"
import { Program } from "@project-serum/anchor"
import { VrfClient } from "../target/types/vrf_client"
import {
  SwitchboardTestContext,
  promiseWithTimeout,
} from "@switchboard-xyz/sbv2-utils"
import * as sbv2 from "@switchboard-xyz/switchboard-v2"
import { PublicKey, SYSVAR_RENT_PUBKEY } from "@solana/web3.js"
import { TOKEN_PROGRAM_ID } from "@project-serum/anchor/dist/cjs/utils/token"
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  getAccount,
  getAssociatedTokenAddress,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  Account,
} from "@solana/spl-token"

describe("vrf-client", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env())

  const program = anchor.workspace.VrfClient as Program<VrfClient>
  const provider = program.provider as anchor.AnchorProvider
  const payer = (provider.wallet as sbv2.AnchorWallet).payer
  const wallet = anchor.workspace.VrfClient.provider.wallet
  const connection = anchor.getProvider().connection

  let switchboard: SwitchboardTestContext

  let vrfClientKey: PublicKey
  let vrfClientBump: number

  let mintAuth: PublicKey
  let mint_one: PublicKey
  let mint_two: PublicKey
  let mint_three: PublicKey
  let stake_mint: PublicKey
  let stake_token_account: Account
  let lootbox: PublicKey

  before(async () => {
    switchboard = await SwitchboardTestContext.loadDevnetQueue(
      provider,
      "F8ce7MsckeZAbAGmxjJNetxYXQa9mKr9nnrC3qKubyYy",
      5_000_000
    )
    // switchboard = await SwitchboardTestContext.loadFromEnv(
    //   program.provider as anchor.AnchorProvider,
    //   undefined,
    //   5_000_000_000 // .005 wSOL
    // )
    await switchboard.oracleHeartbeat()
    const queueData = await switchboard.queue.loadData()
    console.log(`oracleQueue: ${switchboard.queue.publicKey}`)
    console.log(
      `unpermissionedVrfEnabled: ${queueData.unpermissionedVrfEnabled}`
    )
    console.log(`# of oracles heartbeating: ${queueData.queue.length}`)
    console.log(
      "\x1b[32m%s\x1b[0m",
      `\u2714 Switchboard localnet environment loaded successfully\n`
    )
    ;[mintAuth] = await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from("MINT_AUTH")],
      program.programId
    )

    mint_one = await createMint(connection, wallet.payer, mintAuth, null, 0)
    mint_two = await createMint(connection, wallet.payer, mintAuth, null, 0)
    mint_three = await createMint(connection, wallet.payer, mintAuth, null, 0)

    console.log(mint_one.toString())
    console.log(mint_two.toBase58())
    console.log(mint_three.toString())

    stake_mint = await createMint(
      connection,
      wallet.payer,
      wallet.publicKey,
      wallet.publicKey,
      1
    )

    stake_token_account = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      stake_mint,
      payer.publicKey
    )

    console.log(stake_token_account.address)

    await mintTo(
      connection,
      wallet.payer,
      stake_mint,
      stake_token_account.address,
      wallet.payer,
      100_0
    )

    const account = await getAccount(connection, stake_token_account.address)
    console.log(account.amount.toString())
  })

  it("init lootbox", async () => {
    // init vrf state account
    ;[lootbox] = await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from("LOOTBOX")],
      program.programId
    )
    // const tx = await program.methods
    //   .initLootbox()
    //   .accounts({
    //     lootbox: lootbox,
    //     mintOne: mint_one,
    //     mintTwo: mint_two,
    //     mintThree: mint_three,
    //     payer: payer.publicKey,
    //     systemProgram: anchor.web3.SystemProgram.programId,
    //   })
    //   .rpc()
    // console.log("init_client transaction signature", tx)
  })

  it("init_client", async () => {
    const { unpermissionedVrfEnabled, authority, dataBuffer } =
      await switchboard.queue.loadData()

    // keypair for vrf account
    const vrfKeypair = anchor.web3.Keypair.generate()

    // find PDA used for our client state pubkey
    ;[vrfClientKey, vrfClientBump] =
      anchor.utils.publicKey.findProgramAddressSync(
        [Buffer.from("CLIENTSEED"), vrfKeypair.publicKey.toBytes()],
        program.programId
      )

    // create new vrf acount
    const vrfAccount = await sbv2.VrfAccount.create(switchboard.program, {
      keypair: vrfKeypair,
      authority: vrfClientKey, // set vrfAccount authority as PDA
      queue: switchboard.queue,
      callback: {
        programId: program.programId,
        accounts: [
          { pubkey: vrfClientKey, isSigner: false, isWritable: true },
          { pubkey: vrfKeypair.publicKey, isSigner: false, isWritable: false },
          { pubkey: lootbox, isSigner: false, isWritable: false },
          { pubkey: payer.publicKey, isSigner: false, isWritable: false },
        ],
        ixData: new anchor.BorshInstructionCoder(program.idl).encode(
          "consumeRandomness",
          ""
        ),
      },
    })
    console.log(`Created VRF Account: ${vrfAccount.publicKey}`)

    // create permissionAccount
    const permissionAccount = await sbv2.PermissionAccount.create(
      switchboard.program,
      {
        authority,
        granter: switchboard.queue.publicKey,
        grantee: vrfAccount.publicKey,
      }
    )
    console.log(`Created Permission Account: ${permissionAccount.publicKey}`)

    // If queue requires permissions to use VRF, check the correct authority was provided
    if (!unpermissionedVrfEnabled) {
      if (!payer.publicKey.equals(authority)) {
        throw new Error(
          `queue requires PERMIT_VRF_REQUESTS and wrong queue authority provided`
        )
      }

      await permissionAccount.set({
        authority: payer,
        permission: sbv2.SwitchboardPermission.PERMIT_VRF_REQUESTS,
        enable: true,
      })
      console.log(`Set VRF Permissions`)
    }

    // init vrf state account
    const tx = await program.methods
      .initClient({
        maxResult: new anchor.BN(2),
      })
      .accounts({
        state: vrfClientKey,
        vrf: vrfAccount.publicKey,
        payer: payer.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc()
    console.log("init_client transaction signature", tx)
  })

  it("request_randomness", async () => {
    const state = await program.account.vrfClientState.fetch(vrfClientKey)

    const vrfAccount = new sbv2.VrfAccount({
      program: switchboard.program,
      publicKey: state.vrf,
    })
    const vrfState = await vrfAccount.loadData()
    const queueAccount = new sbv2.OracleQueueAccount({
      program: switchboard.program,
      publicKey: vrfState.oracleQueue,
    })
    const queueState = await queueAccount.loadData()
    const [permissionAccount, permissionBump] = sbv2.PermissionAccount.fromSeed(
      switchboard.program,
      queueState.authority,
      queueAccount.publicKey,
      vrfAccount.publicKey
    )
    const [programStateAccount, switchboardStateBump] =
      sbv2.ProgramStateAccount.fromSeed(switchboard.program)

    const request_signature = await program.methods
      .requestRandomness({
        switchboardStateBump,
        permissionBump,
      })
      .accounts({
        state: vrfClientKey,
        vrf: vrfAccount.publicKey,
        oracleQueue: queueAccount.publicKey,
        queueAuthority: queueState.authority,
        dataBuffer: queueState.dataBuffer,
        permission: permissionAccount.publicKey,
        escrow: vrfState.escrow,
        programState: programStateAccount.publicKey,
        switchboardProgram: switchboard.program.programId,
        payerWallet: switchboard.payerTokenWallet,
        payerAuthority: payer.publicKey,
        recentBlockhashes: anchor.web3.SYSVAR_RECENT_BLOCKHASHES_PUBKEY,
        stakeMint: stake_mint,
        stakeTokenAccount: stake_token_account.address,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc()

    console.log(
      `request_randomness transaction signature: ${request_signature}`
    )

    const result = await awaitCallback(program, vrfClientKey, 20_000)

    console.log(`VrfClient Result: ${result}`)

    const updated_state = await program.account.vrfClientState.fetch(
      vrfClientKey
    )

    console.log(updated_state.mint.toString())
    console.log(updated_state.tokenAccount.toString())

    const account = await getAccount(connection, stake_token_account.address)
    console.log(account.amount.toString())

    return
  })

  // it("mint_reward", async () => {
  //   const state = await program.account.vrfClientState.fetch(vrfClientKey)

  //   const request_signature = await program.methods
  //     .mintRewards()
  //     .accounts({
  //       mint: state.mint,
  //       tokenAccount: state.tokenAccount,
  //       mintAuthority: mintAuth,
  //       tokenProgram: TOKEN_PROGRAM_ID,
  //       associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
  //       rent: SYSVAR_RENT_PUBKEY,
  //       systemProgram: anchor.web3.SystemProgram.programId,
  //       user: payer.publicKey,
  //     })
  //     .rpc()

  //   console.log(
  //     `request_randomness transaction signature: ${request_signature}`
  //   )

  //   const account = await getAccount(connection, state.tokenAccount)
  //   console.log(account.amount)

  //   return
  // })
})

async function awaitCallback(
  program: Program<VrfClient>,
  vrfClientKey: anchor.web3.PublicKey,
  timeoutInterval: number,
  errorMsg = "Timed out waiting for VRF Client callback"
) {
  let ws: number | undefined = undefined
  const result: anchor.BN = await promiseWithTimeout(
    timeoutInterval,
    new Promise((resolve: (result: anchor.BN) => void) => {
      ws = program.provider.connection.onAccountChange(
        vrfClientKey,
        async (
          accountInfo: anchor.web3.AccountInfo<Buffer>,
          context: anchor.web3.Context
        ) => {
          const clientState =
            program.account.vrfClientState.coder.accounts.decode(
              "VrfClientState",
              accountInfo.data
            )
          if (clientState.result.gt(new anchor.BN(0))) {
            resolve(clientState.result)
          }
        }
      )
    }).finally(async () => {
      if (ws) {
        await program.provider.connection.removeAccountChangeListener(ws)
      }
      ws = undefined
    }),
    new Error(errorMsg)
  ).finally(async () => {
    if (ws) {
      await program.provider.connection.removeAccountChangeListener(ws)
    }
    ws = undefined
  })

  return result
}
