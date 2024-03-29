import Vue from "vue";
import Web3 from "web3";
import BigNumber from "bignumber.js";
import request from "request";
import YAM from "./abi/yam.json";
import { provider, TransactionReceipt } from "web3-core";
import { GET_BLOCK, GET_BLOCKS, GET_PRICES_BY_BLOCK, GET_HEALTH } from "@/plugins/graphql/queries";
import { AbiItem } from "web3-utils";
import { ethers } from "ethers";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import duration from "dayjs/plugin/duration";
import erc20 from "@studydefi/money-legos/erc20";
import { WETH, DAI, EMPFEB, EMPMAR } from "./addresses";
import { JsonTxResult } from "../interfaces/degenerative.i";
import Assets from "../../protocol/assets.json";

dayjs.extend(utc);
dayjs.extend(duration);

export function stateSave(key, state) {
  window.localStorage.setItem(key, JSON.stringify(state));
}

export function stateLoad(key) {
  if (window.localStorage.getItem(key)) {
    return JSON.parse(window.localStorage.getItem(key) || "");
  } else {
    return null;
  }
}

export function stateDestroy() {
  window.localStorage.clear();
}

export const getERC20Contract = (provider: provider, address: string) => {
  const web3 = new Web3(provider);
  const contract = new web3.eth.Contract((YAM.abi as unknown) as AbiItem, address);
  return contract;
};

export const sleep = (ms: number) => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

const helper = async (arg1, arg2) => {
  const result: number[] = [];

  // Multiply each element in both arrays together.
  for (let i = 0; i < arg1.length; i++) {
    result[i] = arg1[i] * arg2[i];
  }
  return result;
};

const fetchTxs = async (_type: string, _userAddress: string, _count: number, _endBlockNumber: number, _etherscanApiKey: string, _txs) => {
  let url;

  while (_count === 10000) {
    await sleep(500);
    const startBlock = _txs[_txs.length - 1].blockNumber;
    const endBlock = _endBlockNumber;

    switch (_type) {
      case "ether":
        url = `https://api.etherscan.io/api?module=account&action=txlist&address=${_userAddress}&startblock=${startBlock}&endblock=${endBlock}&sort=asc&apikey=${_etherscanApiKey}`;
        break;
      case "erc20":
        url = `https://api.etherscan.io/api?module=account&action=tokentx&address=${_userAddress}&startblock=${startBlock}&endblock=${endBlock}&sort=asc&apikey=${_etherscanApiKey}`;
        break;
      default:
        console.log("No transaction type passed.");
        break;
    }

    const response = await fetch(url);
    const json = await response.json();

    if (json["status"] == 0) {
      break;
    }

    const nextTxs = json["result"];
    _count = nextTxs.length;
    _txs.push(...nextTxs);
  }

  return _txs;
};

export const getTxStats = async (
  provider: provider,
  userAddress: string,
  startTimeStamp: number,
  endTimeStamp: number,
  startBlockNumber: number,
  endBlockNumber: number
): Promise<string[]> => {
  const web3 = new Web3(provider);
  const etherscanApiKey = "YY6XQICVXTH8DIVGUK1TNKZGEKDZV4NV3K";
  let gasFeeTotal = 0;
  let gasPriceTotal = 0;
  let gasFeeTotalFail = 0;

  if (endBlockNumber == 0) {
    // Set current block number to end block number.
    endBlockNumber = await web3.eth.getBlockNumber(function(error, result) {
      if (!error) return result;
    });
  }

  try {
    // Fetch a list of 'normal' unique outgoing transactions by address (maximum of 10000 records only).
    // Continue fetching if response >= 1000.
    let url = `https://api.etherscan.io/api?module=account&action=txlist&address=${userAddress}&startblock=${startBlockNumber}&endblock=${endBlockNumber}&sort=asc&apikey=${etherscanApiKey}`;
    let response = await fetch(url);
    let json = await response.json();
    let txs = json["result"];
    let count = txs.length;
    txs = await fetchTxs("ether", userAddress, count, endBlockNumber, etherscanApiKey, txs);

    // Fetch a list of "ERC20 - Token Transfer Events" by address (maximum of 10000 records only).
    // Continue fetching if response >= 1000.
    url = `https://api.etherscan.io/api?module=account&action=tokentx&address=${userAddress}&startblock=${startBlockNumber}&endblock=${endBlockNumber}&sort=asc&apikey=${etherscanApiKey}`;
    response = await fetch(url);
    json = await response.json();
    const erc20Txs = json["result"];
    count = erc20Txs.length;
    txs.push(...erc20Txs);
    txs = await fetchTxs("erc20", userAddress, count, endBlockNumber, etherscanApiKey, txs);

    // Show only txs that come from the user address.
    let txsOut = txs.filter(v => v.from === userAddress.toLowerCase());

    if (startTimeStamp > 0) {
      txsOut = txsOut.filter(v => v.timeStamp > Math.floor(startTimeStamp / 1000));
    }

    if (endTimeStamp > 0) {
      txsOut = txsOut.filter(v => v.timeStamp < Math.floor(endTimeStamp / 1000));
    }

    txsOut = txsOut.map(({ confirmations, ...item }) => item);
    txsOut = new Set(txsOut.map(JSON.stringify));
    txsOut = Array.from(txsOut);
    const txsOutArray: JsonTxResult = txsOut.map(JSON.parse);
    txsOut = txsOutArray;
    const txsOutCount = txsOut.length;
    const txsOutFail = txsOut.filter(v => v.isError === "1"); // 0 = No Error, 1 = Got Error.
    const txOutFail = txsOutFail.length;

    if (txsOutCount > 0) {
      const gasUsedArray = txsOut.map(value => parseInt(value.gasUsed));
      const gasPriceArray = txsOut.map(value => parseInt(value.gasPrice));
      const gasFee = await helper(gasPriceArray, gasUsedArray);
      gasFeeTotal = gasFee.reduce((partialSum, a) => partialSum + a, 0);
      gasPriceTotal = gasPriceArray.reduce((partialSum, a) => partialSum + a, 0);
      const gasUsedFailArray = txsOutFail.map(value => parseInt(value.gasUsed));
      const gasPriceFailArray = txsOutFail.map(value => parseInt(value.gasPrice));
      const gasFeeFail = await helper(gasPriceFailArray, gasUsedFailArray);
      gasFeeTotalFail = gasFeeFail.reduce((partialSum, a) => partialSum + a, 0);
    }

    const txGasCostETH = new BigNumber(web3.utils.fromWei(gasFeeTotal.toString(), "ether")).decimalPlaces(3);
    let averageTxPrice = new BigNumber(0);

    if (txsOutCount != 0) {
      averageTxPrice = new BigNumber(gasPriceTotal / txsOutCount / 1e9).decimalPlaces(3);
    }

    const txCount = txsOutCount.toString();
    const failedTxCount = txOutFail.toString();
    const failedTxGasCostETH = new BigNumber(web3.utils.fromWei(gasFeeTotalFail.toString(), "ether")).decimalPlaces(3);

    return [txGasCostETH, averageTxPrice, txCount, failedTxCount, failedTxGasCostETH];
  } catch (e) {
    console.log("An error occurred while retrieving your transaction data.\nPlease submit it as an issue.");
    return ["...", "...", "...", "...", "..."];
  }
};

export const getBalance = async (provider: provider, tokenAddress: string, userAddress: string): Promise<string> => {
  const tokenContract = getERC20Contract(provider, tokenAddress);
  try {
    const balance: string = await tokenContract.methods.balanceOf(userAddress).call();
    return balance;
  } catch (e) {
    return "0";
  }
};

export const decToBn = (dec: number, decimals = 18) => {
  return new BigNumber(dec).multipliedBy(new BigNumber(10).pow(decimals));
};

export const splitChartData = (rawData: any) => {
  const categoryData: any = [];
  const values: any = [];
  for (let i = 0; i < rawData.length; i++) {
    categoryData.push(rawData[i].splice(0, 1)[0]);
    values.push(rawData[i]);
  }
  return {
    categoryData: categoryData,
    values: values,
  };
};

export const waitTransaction = async (provider: provider, txHash: string) => {
  const web3 = new Web3(provider);
  let txReceipt: TransactionReceipt | null = null;
  while (txReceipt === null) {
    const r = await web3.eth.getTransactionReceipt(txHash);
    txReceipt = r;
    await sleep(2000);
  }
  return txReceipt.status;
};

export const getLiquidationPrice = (collateral: number, tokens: number, crThreshold: number, inverted: boolean): number => {
  if (tokens <= 0 || crThreshold <= 0 || collateral <= 0) {
    // If liquidation price is 0, then the position can always be liquidated (i.e. it is an invalid position).
    return 0;
  }

  // Solve for token price that would set the proposed CR == crThreshold.
  const liquidationPrice = collateral / tokens / crThreshold;
  return inverted ? 1 / liquidationPrice : liquidationPrice;
};

export const approve = async (
  userAddress: string,
  spenderAddress: string,
  tokenAddress: string,
  provider: provider,
  onTxHash?: (txHash: string) => void
): Promise<boolean> => {
  try {
    const tokenContract = getERC20Contract(provider, tokenAddress);
    return tokenContract.methods
      .approve(spenderAddress, ethers.constants.MaxUint256)
      .send({ from: userAddress, gas: 80000 }, async (error: any, txHash: string) => {
        if (error) {
          console.log("ERC20 could not be approved", error);
          onTxHash && onTxHash("");
          return false;
        }
        if (onTxHash) {
          onTxHash(txHash);
        }
        const status = await waitTransaction(provider, txHash);
        if (!status) {
          console.log("Approval transaction failed.");
          return false;
        }
        return true;
      });
  } catch (e) {
    console.log("error", e);
    return false;
  }
};

export const getAllowance = async (userAddress: string, spenderAddress: string, tokenAddress: string, provider: provider): Promise<string> => {
  try {
    const tokenContract = getERC20Contract(provider, tokenAddress);
    const allowance: string = await tokenContract.methods.allowance(userAddress, spenderAddress).call();
    return allowance;
  } catch (e) {
    return "0";
  }
};

export const checkConnection = async ({ commit, dispatch }) => {
  await sleep(500);
  if (!Vue.prototype.$web3) {
    await dispatch("connect");
  }
};

export const getUgasFromJSON = (jsonData: any) => {
  return Number(jsonData.price / 1000000000000000000);
};

const requestHttp = url => {
  return new Promise((resolve, reject) => {
    request(
      {
        url: url,
        json: true,
      },
      (error, response, body) => {
        if (error) {
          reject(error);
        } else {
          resolve(body);
        }
      }
    );
  });
};

export const getTWAP = async () => {
  const data: any = await requestHttp("https://ugasdata.info/twap-range");
  return data;
};

export const getTWAPData = async () => {
  const TWAP = await getTWAP();
  const plotTWAP: any = [];
  for (const element of TWAP) {
    const newElement = {
      price: getUgasFromJSON({ price: element.price }),
      timestamp: element.timestamp,
    };
    plotTWAP.push(newElement);
  }
  return plotTWAP;
};

export const getLatestBlock = async () => {
  let latestBlock = Vue.prototype.eth.latestBlock;
  let headBlock = Vue.prototype.eth.headBlock;
  await Vue.prototype.gql.health
    .query({
      query: GET_HEALTH,
    })
    .then(res => {
      const latestBlockValue = res.data.indexingStatusForCurrentVersion.chains[0].latestBlock.number;
      const headBlockValue = res.data.indexingStatusForCurrentVersion.chains[0].chainHeadBlock.number;
      if (latestBlockValue && headBlockValue) {
        latestBlock = Vue.prototype.eth.latestBlock = latestBlockValue;
        headBlock = Vue.prototype.eth.headBlock = headBlockValue;
      }
    })
    .catch(e => {
      console.log(e);
    });
  return [latestBlock, headBlock];
};

export async function splitQuery(query, localClient, vars, list, skipCount = 100) {
  let fetchedData = {};
  let allFound = false;
  let skip = 0;
  while (!allFound) {
    let end = list.length;
    if (skip + skipCount < list.length) {
      end = skip + skipCount;
    }
    const sliced = list.slice(skip, end);
    const result = await localClient.query({
      query: query(...vars, sliced),
      fetchPolicy: "cache-first",
    });
    fetchedData = {
      ...fetchedData,
      ...result.data,
    };
    if (Object.keys(result.data).length < skipCount || skip + skipCount > list.length) {
      allFound = true;
    } else {
      skip += skipCount;
    }
  }
  return fetchedData;
}

export const getBlockFromTimestamp = async timestamp => {
  const result = await Vue.prototype.gql.block.query({
    query: GET_BLOCK,
    variables: {
      timestampFrom: timestamp,
      timestampTo: timestamp + 600,
    },
    fetchPolicy: "cache-first",
  });
  return result?.data?.blocks?.[0]?.number;
};

export async function getBlocksFromTimestamps(timestamps, skipCount = 500) {
  if (timestamps?.length === 0) {
    return [];
  }
  const fetchedData = await splitQuery(GET_BLOCKS, Vue.prototype.gql.block, [], timestamps, skipCount);
  const blocks: any = [];
  if (fetchedData) {
    for (const t in fetchedData) {
      if (fetchedData[t].length > 0) {
        blocks.push({
          timestamp: t.split("t")[1],
          number: fetchedData[t][0]["number"],
        });
      }
    }
  }
  return blocks;
}

export const getIntervalTokenData = async (tokenAddress, startTime, interval = 3600) => {
  let latestBlock = Vue.prototype.eth.latestBlock;
  // latestBlock = "11491189";
  const utcEndTime = dayjs.utc();
  const nowUnix = utcEndTime.add(20, "d").unix();

  let time = startTime;
  if (!latestBlock) {
    latestBlock = await getLatestBlock()[0];
  }
  const timestamps: any = [];
  while (time < nowUnix) {
    timestamps.push(time);
    time += interval;
  }
  if (timestamps.length === 0) {
    return [];
  }

  let blocks;
  try {
    blocks = await getBlocksFromTimestamps(timestamps);
    if (!blocks || blocks.length === 0) {
      return [];
    }

    if (latestBlock) {
      blocks = blocks.filter(b => {
        return parseFloat(b.number) <= parseFloat(latestBlock);
      });
    }
    blocks.push({ timestamp: blocks[blocks.length - 1].timestamp, number: (blocks[blocks.length - 1].number - 100).toString() });

    const result = await splitQuery(GET_PRICES_BY_BLOCK, Vue.prototype.gql.client, [tokenAddress], blocks, 60);
    const values: any = [];
    for (const row in result) {
      const timestamp = row.split("t")[1];
      const derivedETH = parseFloat(result[row]?.derivedETH);
      if (timestamp) {
        values.push({
          timestamp,
          derivedETH,
        });
      }
    }
    let index = 0;
    for (const brow in result) {
      const timestamp = brow.split("b")[1];
      if (timestamp) {
        values[index].priceUSD = result[brow].ethPrice * values[index].derivedETH;
        index += 1;
      }
    }
    const shortNumber = function(number) {
      return +parseFloat(number).toFixed(4);
    };
    const formattedHistory: any = [];
    for (let i = 0; i < values.length; i++) {
      const lastIndex = values.length - 1;
      formattedHistory.push({
        timestamp: values[i].timestamp,
        timestampDate: dayjs(values[i].timestamp * 1000).format("MMM, D"), // DD/MM/YYYY
        open: parseFloat(values[i].priceUSD),
        close: parseFloat(values[i === lastIndex ? lastIndex : i + 1].priceUSD),
        openETH: shortNumber(values[i].derivedETH),
        closeETH: shortNumber(values[i === lastIndex ? lastIndex : i + 1].derivedETH),
        twap: (parseFloat(values[i].priceUSD) + parseFloat(values[i === lastIndex ? lastIndex : i + 1].priceUSD)) / 2,
        twapETH: shortNumber((values[i].derivedETH + values[i === lastIndex ? lastIndex : i + 1].derivedETH) / 2),
      });
    }
    return formattedHistory;
  } catch (e) {
    console.log(e, "error fetching blocks");
    return [];
  }
};

export const getUniswapDataHourly = async (token, fromTimestamp) => {
  return await getIntervalTokenData(token, fromTimestamp, 3600);
};

export const getUniswapDataDaily = async (token, fromTimestamp) => {
  return await getIntervalTokenData(token, fromTimestamp, 86400);
};

export async function getContractInfo(address: string) {
  const data: any = await requestHttp(`https://api.coingecko.com/api/v3/coins/ethereum/contract/${address}`);
  return data;
}

export async function getPriceByContract(address: string, toCurrency?: string) {
  const result = await getContractInfo(address);
  return result && result.market_data && result.market_data.current_price[toCurrency || "usd"];
}

export function devMiningCalculator({ provider, getPrice, empAbi }) {
  const web3 = new Web3(provider);
  const { utils, BigNumber, FixedNumber } = ethers;
  const { parseEther } = utils;

  async function getEmpInfo(address: string, toCurrency = "usd") {
    try {
      const emp = new web3.eth.Contract((empAbi as unknown) as AbiItem, address);
      const collateralAddress = await emp.methods.collateralCurrency().call();
      const erc20Contract = new web3.eth.Contract((erc20.abi as unknown) as AbiItem, collateralAddress);
      const size = await emp.methods.rawTotalPositionCollateral().call();
      const price = await getPrice(collateralAddress, toCurrency);
      const decimals = await erc20Contract.methods.decimals().call();
      return {
        address,
        toCurrency,
        collateralAddress,
        size,
        price,
        decimals,
      };
    } catch (e) {
      console.log("error getting emp state", e);
      return "bad";
    }
  }

  function calculateEmpValue({ price, size, decimals }: { price: number; size: string; decimals: number }) {
    const fixedPrice = FixedNumber.from(price.toString() || 0);
    const fixedSize = FixedNumber.fromValue(BigNumber.from(size), decimals);
    return fixedPrice.mulUnsafe(fixedSize);
  }

  async function estimateDevMiningRewards({ totalRewards, empWhitelist }: { totalRewards: number; empWhitelist: string[] }) {
    const allInfo = await Promise.all(empWhitelist.map(address => getEmpInfo(address.toLowerCase())));
    const values: any[] = [];
    const totalValue = allInfo.reduce((totalValue: any, info: any) => {
      const value = calculateEmpValue(info);
      values.push(value);
      return totalValue.addUnsafe(value);
    }, FixedNumber.from("0"));
    return allInfo.map((info: any, i: any): [string, string] => {
      return [
        info.address,
        values[i]
          .mulUnsafe(FixedNumber.from(totalRewards))
          .divUnsafe(totalValue)
          .toString(),
      ];
    });
  }

  return {
    estimateDevMiningRewards,
    utils: {
      getEmpInfo,
      calculateEmpValue,
    },
  };
}

export function formAssetName(assetName, assetInstance) {
  if (assetName && assetInstance) {
    return assetName.toUpperCase() + assetInstance.cycle + assetInstance.year;
  } else {
    return "not found";
  }
  // UGASJAN21
}

function mergeUnique(arr1, arr2) {
  return arr1.concat(
    arr2.filter(function(item) {
      return arr1.indexOf(item) === -1;
    })
  );
}

// to reinit
// export async function getTokenPrice(token) {
//   const ethUnitPrice: any = getUniPrice(WETH, DAI);
//   let tokenPrice: any = getUniPrice(token, WETH);
//   tokenPrice = tokenPrice * ethUnitPrice;
//   return tokenPrice;
// }

const emplistDataBackup = {
  empWhitelist: [
    "0xf215778F3a5e7Ab6A832e71d87267Dd9a9aB0037",
    "0x7c4090170aeADD54B1a0DbAC2C8D08719220A435",
    "0xaB3Aa2768Ba6c5876B2552a6F9b70E54aa256175",
    "0x9E929a85282fB0555C19Ed70942B952827Ca4B0B",
    "0x6DA66C15823cFf681DaD6963fBD325a520362958",
    "0xD50fbace72352C2e15E0986b8Ad2599627B5c340",
    "0x45788a369f3083c02b942aEa02DBa25C466a773F",
    "0x0388f65C185a7E7D857BB142185381d97a4bc747",
    "0x9bB1f39b6DB45BD087046385a43EAb7b60C52e7D",
    "0x14A415Dd90B63c791C5dc544594605c8bC13Bc8D",
    "0x1066E9D2E372d01A0F57bB6f231D34Ce4CEd228e",
    "0xa24Ba528Be99024f7F7C227b55cBb265ecf0C078",
    "0xd60139B287De1408f8388f5f57fC114Fb4B03328",
    "0x8E51Ad4EeB19693751a9A3E36b8F098D891Ddc7f",
    "0x4E8d60A785c2636A63c5Bd47C7050d21266c8B43",
    "0x4F1424Cef6AcE40c0ae4fc64d74B734f1eAF153C",
    "0x964Be01cCe200e168c4ba960a764cBEBa8C01200",
    "0xDB2E7F6655de37822c3020a8988351CC76caDAD5",
    "0x52f83ACA94904b3590669E3525d25ec75cDFf798",
    "0xd9af2d7E4cF86aAfBCf688a47Bd6b95Da9F7c838",
    "0x0f4e2a456aAfc0068a0718E3107B88d2e8f2bfEF",
    "0x312Ecf2854f73a3Ff616e3CDBC05E2Ff6A98d1f0",
    "0xCef85b352CCD7a446d94AEeeA02dD11622289954",
    "0x56BaBEcb3dCaC063697fE38AB745c10181c56fA6",
    "0x10E018C01792705BefB7A757628C2947E38B9426",
    "0xb40BA94747c59d076B3c189E3A031547492013da",
    "0x46f5E363e69798a74c8422BFb9EDB63e3FB0f08a"
  ],
  totalReward: 50000,
};

export async function getDevMiningEmps() {
  const assets: any = Assets;
  if (assets) {
    const data = [
      assets["ugas"][1].emp.address,
      assets["ugas"][2].emp.address,
      assets["ugas"][3].emp.address,
      assets["ustonks"][0].emp.address,
      assets["ustonks"][1].emp.address
    ];

    const umadata: any = await requestHttp(`https://raw.githubusercontent.com/UMAprotocol/protocol/master/packages/affiliates/payouts/devmining-status.json`);
    const empWhitelistUpdated = mergeUnique(umadata.empWhitelist, data);
    umadata.empWhitelist = empWhitelistUpdated;
    return umadata;
    // return emplistDataBackup;
  } else {
    return -1;
  }
}

export const get30DMedian = async () => {
  const data: any = await requestHttp("https://data.yam.finance/median-history");
  // return data.slice(Math.max(data.length - 20, 0));
  return data;
};

export const getCurrentTWAP = async (poolAddress) => {
  const web3 = new Web3();
  const data: any = await requestHttp(`https://data.yam.finance/twap/pair/${poolAddress}`);
  if (JSON.stringify(data) == JSON.stringify({})) {
    return -1;
  }

  const currentTWAP = new BigNumber(data.price).decimalPlaces(parseInt(data.roundingDecimals));
  
  return currentTWAP;
};

export const getIndexFromSpreadsheet = async (cycle) => {
  const data: any = await requestHttp(`https://data.yam.finance/ustonks/index/${cycle}`);
  const indexValue = new BigNumber(data.price).decimalPlaces(2);
  return indexValue;
};
